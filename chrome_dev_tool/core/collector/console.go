package collector

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/cdp"
	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/events"
)

func wireConsole(ctx context.Context, cl *cdp.Client, sink Sink) error {
	if _, err := cl.Send(ctx, "Runtime.enable", nil); err != nil {
		return fmt.Errorf("Runtime.enable: %w", err)
	}
	if _, err := cl.Send(ctx, "Log.enable", nil); err != nil {
		return fmt.Errorf("Log.enable: %w", err)
	}

	cl.On("Runtime.consoleAPICalled", func(p json.RawMessage) {
		var wrap struct {
			Type string `json:"type"`
			Args []struct {
				Type        string          `json:"type"`
				Value       json.RawMessage `json:"value,omitempty"`
				Description string          `json:"description,omitempty"`
			} `json:"args"`
		}
		if err := json.Unmarshal(p, &wrap); err != nil {
			return
		}
		text := ""
		for i, a := range wrap.Args {
			if i > 0 {
				text += " "
			}
			if len(a.Value) > 0 {
				text += string(a.Value)
			} else {
				text += a.Description
			}
		}
		sink.Emit(events.New(events.KindConsole, events.ConsoleEntry{
			Level: wrap.Type, Text: text,
		}))
	})

	cl.On("Runtime.exceptionThrown", func(p json.RawMessage) {
		var wrap struct {
			ExceptionDetails struct {
				Text       string `json:"text"`
				URL        string `json:"url"`
				LineNumber int    `json:"lineNumber"`
				Exception  struct {
					Description string `json:"description"`
				} `json:"exception"`
			} `json:"exceptionDetails"`
		}
		if err := json.Unmarshal(p, &wrap); err != nil {
			return
		}
		text := wrap.ExceptionDetails.Text
		if d := wrap.ExceptionDetails.Exception.Description; d != "" {
			text = d
		}
		sink.Emit(events.New(events.KindException, events.ConsoleEntry{
			Level: "error",
			Text:  text,
			URL:   wrap.ExceptionDetails.URL,
			Line:  wrap.ExceptionDetails.LineNumber,
		}))
	})

	cl.On("Log.entryAdded", func(p json.RawMessage) {
		var wrap struct {
			Entry struct {
				Source string `json:"source"`
				Level  string `json:"level"`
				Text   string `json:"text"`
				URL    string `json:"url"`
			} `json:"entry"`
		}
		if err := json.Unmarshal(p, &wrap); err != nil {
			return
		}
		sink.Emit(events.New(events.KindLog, events.ConsoleEntry{
			Level: wrap.Entry.Level,
			Text:  wrap.Entry.Text,
			URL:   wrap.Entry.URL,
		}))
	})

	return nil
}
