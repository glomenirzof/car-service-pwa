// Native inputs (datetime-local, decimal) where the mobile OS picker/keypad is
// the best UX, wrapped in Astryx Field for label, status and accessibility.
import {useId, type InputHTMLAttributes} from 'react';
import {Field} from '@astryxdesign/core/Field';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  description?: string;
};

export function NativeField({label, value, onChange, error, description, required, ...rest}: Props) {
  const id = useId();
  const statusId = `${id}-status`;
  return (
    <Field label={label} inputID={id} isRequired={required} description={description} status={error ? {type: 'error', message: error, messageID: statusId} : undefined} width="100%">
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? statusId : undefined}
        required={required}
        className="h-11 w-full rounded-md border border-border bg-surface px-3 text-base text-primary [color-scheme:dark] focus:border-accent-bg focus:outline-none"
        {...rest}
      />
    </Field>
  );
}
