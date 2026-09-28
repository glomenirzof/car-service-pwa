// Phone input with the numeric keypad on mobile (inputMode="tel",
// autocomplete="tel"), wrapped in Astryx Field for label/status/a11y.
import {useId} from 'react';
import {Field} from '@astryxdesign/core/Field';

export function PhoneField({
  value,
  onChange,
  error,
  label = 'Телефон',
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  label?: string;
}) {
  const id = useId();
  const statusId = `${id}-status`;
  return (
    <Field label={label} inputID={id} isRequired status={error ? {type: 'error', message: error, messageID: statusId} : undefined} width="100%">
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+7 999 123-45-67"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? statusId : undefined}
        className="h-11 w-full rounded-md border border-border bg-surface px-3 text-base text-primary placeholder:text-secondary focus:border-accent-bg focus:outline-none"
      />
    </Field>
  );
}
