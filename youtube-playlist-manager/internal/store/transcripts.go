package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

// Segment is one caption line.
type Segment struct {
	Start    float64 `json:"start"`
	Duration float64 `json:"duration"`
	Text     string  `json:"text"`
}

// Transcript is a stored transcript body.
type Transcript struct {
	VideoID      string    `json:"videoId"`
	Language     string    `json:"language"`
	LanguageName string    `json:"languageName"`
	IsGenerated  bool      `json:"isGenerated"`
	IsTranslated bool      `json:"isTranslated"`
	Text         string    `json:"text"`
	Segments     []Segment `json:"segments"`
	FetchedAt    time.Time `json:"fetchedAt"`
}

// Video IDs are [A-Za-z0-9_-]; anything else must never reach the filesystem.
var reSafeID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func (s *Store) transcriptPath(videoID string) (string, error) {
	if !reSafeID.MatchString(videoID) {
		return "", errors.New("invalid video id")
	}
	return filepath.Join(filepath.Dir(s.path), "transcripts", videoID+".json"), nil
}

// TranscriptMeta returns the index entry of a video's transcript.
func (s *Store) TranscriptMeta(videoID string) (TranscriptMeta, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m, ok := s.d.Transcripts[videoID]
	if !ok {
		return TranscriptMeta{}, false
	}
	return *m, true
}

// SaveTranscript writes the body to its own file and records it as fetched.
func (s *Store) SaveTranscript(t Transcript) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.path != "" {
		p, err := s.transcriptPath(t.VideoID)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return err
		}
		b, err := json.Marshal(t)
		if err != nil {
			return err
		}
		if err := os.WriteFile(p+".tmp", b, 0o600); err != nil {
			return err
		}
		if err := os.Rename(p+".tmp", p); err != nil {
			return err
		}
	} else {
		if s.mem == nil {
			s.mem = map[string]Transcript{}
		}
		s.mem[t.VideoID] = t
	}
	s.d.Transcripts[t.VideoID] = &TranscriptMeta{
		VideoID: t.VideoID, Status: TranscriptOK, Language: t.Language, LanguageName: t.LanguageName,
		IsGenerated: t.IsGenerated, IsTranslated: t.IsTranslated, Chars: len([]rune(t.Text)), FetchedAt: t.FetchedAt,
	}
	return s.saveLocked()
}

// MarkTranscript records a non-OK outcome (TranscriptNone / TranscriptError).
// An existing OK transcript is kept when a retry fails with an error.
func (s *Store) MarkTranscript(videoID, status, msg string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if old, ok := s.d.Transcripts[videoID]; ok && old.Status == TranscriptOK && status == TranscriptError {
		return nil
	}
	if status == TranscriptNone {
		s.deleteTranscriptLocked(videoID)
	}
	s.d.Transcripts[videoID] = &TranscriptMeta{VideoID: videoID, Status: status, Error: msg, FetchedAt: s.now()}
	return s.saveLocked()
}

// Transcript loads a stored transcript body.
func (s *Store) Transcript(videoID string) (Transcript, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m, ok := s.d.Transcripts[videoID]
	if !ok || m.Status != TranscriptOK {
		return Transcript{}, ErrNotFound
	}
	if s.path == "" {
		t, ok := s.mem[videoID]
		if !ok {
			return Transcript{}, ErrNotFound
		}
		return t, nil
	}
	p, err := s.transcriptPath(videoID)
	if err != nil {
		return Transcript{}, err
	}
	b, err := os.ReadFile(p)
	if errors.Is(err, os.ErrNotExist) {
		return Transcript{}, ErrNotFound
	}
	if err != nil {
		return Transcript{}, err
	}
	var t Transcript
	return t, json.Unmarshal(b, &t)
}

// deleteTranscriptLocked removes the index entry and body. Caller holds s.mu.
func (s *Store) deleteTranscriptLocked(videoID string) {
	delete(s.d.Transcripts, videoID)
	delete(s.mem, videoID)
	if s.path != "" {
		if p, err := s.transcriptPath(videoID); err == nil {
			_ = os.Remove(p)
		}
	}
}
