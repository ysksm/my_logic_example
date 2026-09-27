package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/store"
	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/transcript"
)

// TranscriptMode selects which videos get their transcript fetched.
type TranscriptMode string

const (
	// TranscriptsMissing fetches only videos never tried before or whose
	// last attempt failed.
	TranscriptsMissing TranscriptMode = "missing"
	// TranscriptsAll re-fetches every video's transcript.
	TranscriptsAll TranscriptMode = "all"
)

// TranscriptScope is the set of videos to process.
type TranscriptScope struct {
	ChannelID  string
	PlaylistID string
}

// TranscriptResult summarises a transcript run.
type TranscriptResult struct {
	Fetched int `json:"fetched"`
	None    int `json:"none"`
	Failed  int `json:"failed"`
	Skipped int `json:"skipped"`
}

func (s *Service) transcriptFetcher() *transcript.Fetcher {
	f := transcript.New()
	if s.transcriptBase != "" {
		f.BaseURL = s.transcriptBase
	}
	return f
}

// SetTranscriptBaseURL points transcript fetching at another host (tests).
func (s *Service) SetTranscriptBaseURL(u string) { s.transcriptBase = u }

// SetTranscriptDelay sets the pause between videos in bulk transcript runs.
// A pause keeps YouTube from rate-limiting us.
func (s *Service) SetTranscriptDelay(d time.Duration) { s.transcriptDelay = d }

// fetchTranscript downloads and stores one transcript. It returns the
// transcript error (nil, ErrNoTranscript, …) after recording the outcome.
func (s *Service) fetchTranscript(ctx context.Context, f *transcript.Fetcher, videoID string) error {
	t, err := f.Fetch(ctx, videoID)
	switch {
	case err == nil:
		segs := make([]store.Segment, len(t.Segments))
		for i, sg := range t.Segments {
			segs[i] = store.Segment{Start: sg.Start, Duration: sg.Duration, Text: sg.Text}
		}
		return s.st.SaveTranscript(store.Transcript{
			VideoID: videoID, Language: t.Language, LanguageName: t.LanguageName,
			IsGenerated: t.IsGenerated, IsTranslated: t.IsTranslated,
			Text: t.Text(), Segments: segs, FetchedAt: time.Now(),
		})
	case errors.Is(err, transcript.ErrNoTranscript):
		_ = s.st.MarkTranscript(videoID, store.TranscriptNone, err.Error())
		return err
	case errors.Is(err, context.Canceled):
		return err
	default:
		_ = s.st.MarkTranscript(videoID, store.TranscriptError, err.Error())
		return err
	}
}

// FetchTranscript fetches (or re-fetches) one video's transcript.
func (s *Service) FetchTranscript(ctx context.Context, videoID string) (store.Transcript, error) {
	if _, err := s.st.Video(videoID); err != nil {
		return store.Transcript{}, err
	}
	if err := s.fetchTranscript(ctx, s.transcriptFetcher(), videoID); err != nil {
		return store.Transcript{}, err
	}
	return s.st.Transcript(videoID)
}

// FetchTranscripts fetches transcripts of every stored video in scope. It
// uses no Data API quota. It stops early when YouTube starts blocking.
func (s *Service) FetchTranscripts(ctx context.Context, scope TranscriptScope, mode TranscriptMode, progress Progress) (TranscriptResult, error) {
	var res TranscriptResult
	key := "tr:" + scope.ChannelID + scope.PlaylistID
	unlock, err := s.lock(key)
	if err != nil {
		return res, err
	}
	defer unlock()

	var videos []store.Video
	switch {
	case scope.PlaylistID != "":
		if _, err := s.st.Playlist(scope.PlaylistID); err != nil {
			return res, err
		}
		videos = s.st.Videos(store.VideoFilter{PlaylistID: scope.PlaylistID})
	case scope.ChannelID != "":
		if _, err := s.st.Channel(scope.ChannelID); err != nil {
			return res, err
		}
		videos = s.st.Videos(store.VideoFilter{ChannelID: scope.ChannelID})
	default:
		return res, errors.New("対象のチャンネルまたは再生リストを指定してください")
	}

	var todo []string
	for _, v := range videos {
		if mode == TranscriptsMissing && (v.TranscriptStatus == store.TranscriptOK || v.TranscriptStatus == store.TranscriptNone) {
			res.Skipped++
			continue
		}
		todo = append(todo, v.ID)
	}

	f := s.transcriptFetcher()
	for i, id := range todo {
		if i > 0 && s.transcriptDelay > 0 {
			select {
			case <-ctx.Done():
				return res, ctx.Err()
			case <-time.After(s.transcriptDelay):
			}
		}
		if err := ctx.Err(); err != nil {
			return res, err
		}
		err := s.fetchTranscript(ctx, f, id)
		switch {
		case err == nil:
			res.Fetched++
		case errors.Is(err, transcript.ErrNoTranscript):
			res.None++
		case errors.Is(err, context.Canceled):
			return res, err
		case errors.Is(err, transcript.ErrBlocked):
			res.Failed++
			return res, fmt.Errorf("%d / %d 本で中断: %w", i+1, len(todo), err)
		default:
			res.Failed++
		}
		progress.report(i+1, len(todo), fmt.Sprintf("字幕 %d / %d 本（取得 %d・字幕なし %d・失敗 %d）", i+1, len(todo), res.Fetched, res.None, res.Failed))
	}
	return res, nil
}
