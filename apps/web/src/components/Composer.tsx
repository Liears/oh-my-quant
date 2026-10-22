import { useRef, useState } from "react";

interface ComposerProps {
  readonly running: boolean;
  readonly onSubmit: (text: string) => void;
  readonly onCancel: () => void;
}

export function Composer({ running, onSubmit, onCancel }: ComposerProps) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = value.trim();
    if (text.length === 0) return;
    onSubmit(text);
    setValue("");
    input.current?.focus();
  };

  return (
    <div className="composer">
      <div className="composer__box">
        <textarea
          ref={input}
          className="composer__input"
          value={value}
          placeholder="输入研究问题 · /config 配置 · /artifact 报告"
          rows={2}
          onChange={event => setValue(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <div className="composer__foot">
        <span>Enter 发送 · Shift+Enter 换行</span>
        {running ? (
          <button type="button" className="composer__send" onClick={onCancel}>
            停止
          </button>
        ) : (
          <button
            type="button"
            className="composer__send"
            disabled={value.trim().length === 0}
            onClick={submit}
          >
            发送
          </button>
        )}
      </div>
    </div>
  );
}
