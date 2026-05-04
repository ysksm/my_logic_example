"""文字起こし取得

責務:
- youtube-transcript-api を使った字幕取得
- 言語優先度（ja → ja-JP → 自動翻訳 ja → en）の解決
"""

import json
import logging

logger = logging.getLogger(__name__)


class TranscriptFetcher:
    """YouTube 動画の字幕（手動字幕・自動生成・自動翻訳）を取得"""

    DEFAULT_LANGUAGES = ["ja", "ja-JP"]

    def __init__(self, languages: list[str] | None = None,
                 translate_to: str | None = "ja"):
        """
        languages: 優先する言語コード（最初に見つかったものを採用）
        translate_to: 該当言語が無い場合に自動翻訳する言語（None で無効）
        """
        self.languages = languages or self.DEFAULT_LANGUAGES
        self.translate_to = translate_to

    def fetch(self, video_id: str) -> dict | None:
        """字幕を取得して dict を返す。取得不可なら None。

        返り値:
          {
            "language": "ja",
            "is_generated": True,
            "text": "...",       # 全文を改行で結合
            "segments": [{"start": float, "duration": float, "text": str}, ...]
          }
        """
        try:
            from youtube_transcript_api import (  # type: ignore
                YouTubeTranscriptApi,
                NoTranscriptFound,
                TranscriptsDisabled,
                VideoUnavailable,
            )
        except ImportError as e:
            logger.warning("youtube-transcript-api が未インストール: %s", e)
            return None

        try:
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
        except (TranscriptsDisabled, VideoUnavailable) as e:
            logger.info("字幕取得不可 %s: %s", video_id, e)
            return None
        except Exception as e:
            logger.warning("字幕一覧取得失敗 %s: %s", video_id, e)
            return None

        transcript = None
        # 1. 手動字幕を優先
        try:
            transcript = transcript_list.find_manually_created_transcript(self.languages)
        except NoTranscriptFound:
            pass

        # 2. 自動生成字幕
        if transcript is None:
            try:
                transcript = transcript_list.find_generated_transcript(self.languages)
            except NoTranscriptFound:
                pass

        # 3. 翻訳可能な字幕を翻訳
        if transcript is None and self.translate_to:
            for t in transcript_list:
                if t.is_translatable:
                    try:
                        transcript = t.translate(self.translate_to)
                        break
                    except Exception:
                        continue

        if transcript is None:
            logger.info("字幕が見つかりません: %s (希望: %s)", video_id, self.languages)
            return None

        try:
            segments = transcript.fetch()
        except Exception as e:
            logger.warning("字幕本文取得失敗 %s: %s", video_id, e)
            return None

        # youtube-transcript-api 0.6+ は dict のリスト、新しめは FetchedTranscriptSnippet
        normalized = []
        for s in segments:
            if isinstance(s, dict):
                normalized.append({
                    "start": float(s.get("start", 0.0)),
                    "duration": float(s.get("duration", 0.0)),
                    "text": str(s.get("text", "")),
                })
            else:
                normalized.append({
                    "start": float(getattr(s, "start", 0.0)),
                    "duration": float(getattr(s, "duration", 0.0)),
                    "text": str(getattr(s, "text", "")),
                })

        full_text = "\n".join(s["text"] for s in normalized if s["text"])

        return {
            "language": transcript.language_code,
            "is_generated": bool(transcript.is_generated),
            "text": full_text,
            "segments": json.dumps(normalized, ensure_ascii=False),
        }
