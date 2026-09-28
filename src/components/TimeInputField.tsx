/* ------------------------------------------------------------------ */
/* Typed time entry ("9", "930", "9:30" → 09:30) with quarter-hour     */
/* suggestions. Commits on blur / Enter; invalid input snaps back.     */
/* ------------------------------------------------------------------ */

import { useEffect, useId, useState } from "react";
import { Clock } from "lucide-react";

import { parseTimeInput, quarterHourOptions } from "@/lib/scheduling";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

const SUGGESTIONS = quarterHourOptions(6 * 60, 22 * 60 + 1);

export function TimeInputField({
  id,
  value,
  onChange,
  "aria-invalid": ariaInvalid,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  "aria-invalid"?: boolean;
}) {
  const listId = useId();
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(value);
    setInvalid(false);
  }, [value]);

  const commit = () => {
    const parsed = parseTimeInput(text);
    if (!parsed) {
      setInvalid(text.trim() !== "");
      setText(value);
      return;
    }
    setInvalid(false);
    setText(parsed);
    if (parsed !== value) onChange(parsed);
  };

  return (
    <InputGroup className="h-8">
      <InputGroupAddon>
        <Clock />
      </InputGroupAddon>
      <InputGroupInput
        id={id}
        inputMode="numeric"
        autoComplete="off"
        placeholder="HH:MM"
        list={listId}
        className="tabular-nums"
        aria-invalid={ariaInvalid || invalid}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          // Picking a suggestion from the list fires a change with a full
          // "HH:MM" value — take it right away.
          const exact = /^\d{2}:\d{2}$/.test(event.target.value)
            ? parseTimeInput(event.target.value)
            : null;
          if (exact && SUGGESTIONS.includes(exact) && exact !== value) onChange(exact);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
      <datalist id={listId}>
        {SUGGESTIONS.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </InputGroup>
  );
}
