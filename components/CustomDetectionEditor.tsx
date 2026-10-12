'use client';

import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type {
  DetectionOperator,
  DetectionRule,
  FileDetectionRule,
  FileDetectionType,
  MsiDetectionRule,
  RegistryDetectionRule,
  RegistryDetectionType,
} from '@/types/intune';

// Only declarative rule types are editable here. Script detection is not offered.
export type EditableDetectionRuleType = 'registry' | 'file' | 'msi';

const RULE_TYPE_LABELS: Record<EditableDetectionRuleType, string> = {
  registry: 'Registry',
  file: 'File or folder',
  msi: 'MSI product code',
};

const REGISTRY_DETECTION_TYPES: Array<{ value: RegistryDetectionType; label: string }> = [
  { value: 'exists', label: 'Key or value exists' },
  { value: 'notExists', label: 'Key or value does not exist' },
  { value: 'version', label: 'Version comparison' },
  { value: 'string', label: 'String comparison' },
  { value: 'integer', label: 'Integer comparison' },
];

const FILE_DETECTION_TYPES: Array<{ value: FileDetectionType; label: string }> = [
  { value: 'exists', label: 'File or folder exists' },
  { value: 'notExists', label: 'File or folder does not exist' },
  { value: 'version', label: 'File version' },
  { value: 'sizeInMB', label: 'Size in MB' },
];

const OPERATORS: Array<{ value: DetectionOperator; label: string }> = [
  { value: 'equal', label: 'Equals' },
  { value: 'notEqual', label: 'Not equal to' },
  { value: 'greaterThanOrEqual', label: 'Greater than or equal to' },
  { value: 'greaterThan', label: 'Greater than' },
  { value: 'lessThanOrEqual', label: 'Less than or equal to' },
  { value: 'lessThan', label: 'Less than' },
];

const COMPARISON_TYPES = new Set<string>(['version', 'string', 'integer', 'sizeInMB']);

export function createEmptyDetectionRule(type: EditableDetectionRuleType): DetectionRule {
  switch (type) {
    case 'file':
      return { type: 'file', path: '', fileOrFolderName: '', detectionType: 'exists', check32BitOn64System: false };
    case 'msi':
      return { type: 'msi', productCode: '' };
    default:
      return { type: 'registry', keyPath: '', detectionType: 'exists', check32BitOn64System: false };
  }
}

// Switching between "exists" and a comparison keeps the rule shape minimal:
// existence checks carry no operator or expected value.
function withDetectionType<T extends RegistryDetectionRule | FileDetectionRule>(
  rule: T,
  detectionType: T['detectionType']
): T {
  if (!COMPARISON_TYPES.has(detectionType)) {
    const { operator: _operator, detectionValue: _value, ...rest } = rule;
    return { ...rest, detectionType } as T;
  }
  return {
    ...rule,
    detectionType,
    operator: rule.operator ?? (detectionType === 'version' || detectionType === 'sizeInMB' ? 'greaterThanOrEqual' : 'equal'),
    detectionValue: rule.detectionValue ?? '',
  };
}

interface CustomDetectionEditorProps {
  rules: DetectionRule[];
  onChange: (rules: DetectionRule[]) => void;
  errors?: string[];
}

const inputClass =
  'w-full px-3 py-2 bg-bg-elevated border border-overlay/10 rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/50';
const labelClass = 'block text-xs font-medium text-text-secondary mb-1';

export function CustomDetectionEditor({ rules, onChange, errors = [] }: CustomDetectionEditorProps) {
  const updateRule = (index: number, rule: DetectionRule) => {
    onChange(rules.map((r, i) => (i === index ? rule : r)));
  };
  const removeRule = (index: number) => {
    onChange(rules.filter((_, i) => i !== index));
  };
  const addRule = () => {
    onChange([...rules, createEmptyDetectionRule('registry')]);
  };

  return (
    <div className="space-y-3">
      {rules.length === 0 && (
        <p className="text-text-muted text-sm italic">Add at least one detection rule.</p>
      )}
      {rules.map((rule, index) => (
        <RuleEditor
          key={index}
          index={index}
          rule={rule}
          onChange={(next) => updateRule(index, next)}
          onRemove={() => removeRule(index)}
        />
      ))}
      <button
        type="button"
        onClick={addRule}
        className="flex items-center gap-1.5 text-sm text-accent-cyan hover:text-accent-cyan/80 transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add detection rule
      </button>
      {errors.length > 0 && (
        <div role="alert" className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 space-y-1">
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}
    </div>
  );
}

interface RuleEditorProps {
  index: number;
  rule: DetectionRule;
  onChange: (rule: DetectionRule) => void;
  onRemove: () => void;
}

function RuleEditor({ index, rule, onChange, onRemove }: RuleEditorProps) {
  const id = useId();
  const n = index + 1;
  const editable = rule.type === 'registry' || rule.type === 'file' || rule.type === 'msi';

  return (
    <div className="bg-bg-elevated/50 rounded-lg p-3 space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor={`${id}-type`} className={labelClass}>Rule {n} type</label>
          {editable ? (
            <select
              id={`${id}-type`}
              value={rule.type}
              onChange={(e) => onChange(createEmptyDetectionRule(e.target.value as EditableDetectionRuleType))}
              className={inputClass}
            >
              {(Object.keys(RULE_TYPE_LABELS) as EditableDetectionRuleType[]).map((type) => (
                <option key={type} value={type}>{RULE_TYPE_LABELS[type]}</option>
              ))}
            </select>
          ) : (
            <p id={`${id}-type`} className="text-sm text-text-muted">
              This rule type cannot be edited here. Remove it and add a registry, file or MSI rule.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove rule ${n}`}
          className="p-2 text-text-muted hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {rule.type === 'registry' && <RegistryFields id={id} n={n} rule={rule} onChange={onChange} />}
      {rule.type === 'file' && <FileFields id={id} n={n} rule={rule} onChange={onChange} />}
      {rule.type === 'msi' && <MsiFields id={id} n={n} rule={rule} onChange={onChange} />}
    </div>
  );
}

interface FieldsProps<T> {
  id: string;
  n: number;
  rule: T;
  onChange: (rule: DetectionRule) => void;
}

function TextField({ id, label, value, placeholder, onChange }: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </div>
  );
}

function ComparisonFields({ id, n, operator, value, valueLabel, onOperator, onValue }: {
  id: string;
  n: number;
  operator?: DetectionOperator;
  value?: string;
  valueLabel: string;
  onOperator: (operator: DetectionOperator) => void;
  onValue: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label htmlFor={`${id}-operator`} className={labelClass}>Rule {n} operator</label>
        <select
          id={`${id}-operator`}
          value={operator ?? 'equal'}
          onChange={(e) => onOperator(e.target.value as DetectionOperator)}
          className={inputClass}
        >
          {OPERATORS.map((op) => (
            <option key={op.value} value={op.value}>{op.label}</option>
          ))}
        </select>
      </div>
      <TextField id={`${id}-value`} label={`Rule ${n} ${valueLabel}`} value={value ?? ''} onChange={onValue} />
    </div>
  );
}

function Check32BitField({ id, n, checked, onChange }: {
  id: string;
  n: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={`${id}-32bit`} className="flex items-center gap-2 text-xs text-text-secondary">
      <input
        id={`${id}-32bit`}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      Rule {n}: check the 32 bit location on 64 bit systems
    </label>
  );
}

function RegistryFields({ id, n, rule, onChange }: FieldsProps<RegistryDetectionRule>) {
  return (
    <div className="space-y-2">
      <TextField
        id={`${id}-key`}
        label={`Rule ${n} key path`}
        value={rule.keyPath}
        placeholder="HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{ProductCode}"
        onChange={(keyPath) => onChange({ ...rule, keyPath })}
      />
      <TextField
        id={`${id}-valueName`}
        label={`Rule ${n} value name (optional)`}
        value={rule.valueName ?? ''}
        placeholder="DisplayVersion"
        onChange={(valueName) => {
          const { valueName: _old, ...rest } = rule;
          onChange(valueName ? { ...rest, valueName } : rest);
        }}
      />
      <div>
        <label htmlFor={`${id}-detection`} className={labelClass}>Rule {n} detection method</label>
        <select
          id={`${id}-detection`}
          value={rule.detectionType}
          onChange={(e) => onChange(withDetectionType(rule, e.target.value as RegistryDetectionType))}
          className={inputClass}
        >
          {REGISTRY_DETECTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>
      {COMPARISON_TYPES.has(rule.detectionType) && (
        <ComparisonFields
          id={id}
          n={n}
          operator={rule.operator}
          value={rule.detectionValue}
          valueLabel="expected value"
          onOperator={(operator) => onChange({ ...rule, operator })}
          onValue={(detectionValue) => onChange({ ...rule, detectionValue })}
        />
      )}
      <Check32BitField
        id={id}
        n={n}
        checked={Boolean(rule.check32BitOn64System)}
        onChange={(check32BitOn64System) => onChange({ ...rule, check32BitOn64System })}
      />
    </div>
  );
}

function FileFields({ id, n, rule, onChange }: FieldsProps<FileDetectionRule>) {
  return (
    <div className="space-y-2">
      <TextField
        id={`${id}-path`}
        label={`Rule ${n} folder path`}
        value={rule.path}
        placeholder="C:\Program Files\Contoso"
        onChange={(path) => onChange({ ...rule, path })}
      />
      <TextField
        id={`${id}-name`}
        label={`Rule ${n} file or folder name`}
        value={rule.fileOrFolderName}
        placeholder="app.exe"
        onChange={(fileOrFolderName) => onChange({ ...rule, fileOrFolderName })}
      />
      <div>
        <label htmlFor={`${id}-detection`} className={labelClass}>Rule {n} detection method</label>
        <select
          id={`${id}-detection`}
          value={rule.detectionType}
          onChange={(e) => onChange(withDetectionType(rule, e.target.value as FileDetectionType))}
          className={inputClass}
        >
          {FILE_DETECTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>
      {COMPARISON_TYPES.has(rule.detectionType) && (
        <ComparisonFields
          id={id}
          n={n}
          operator={rule.operator}
          value={rule.detectionValue}
          valueLabel={rule.detectionType === 'sizeInMB' ? 'size in MB' : 'version'}
          onOperator={(operator) => onChange({ ...rule, operator })}
          onValue={(detectionValue) => onChange({ ...rule, detectionValue })}
        />
      )}
      <Check32BitField
        id={id}
        n={n}
        checked={Boolean(rule.check32BitOn64System)}
        onChange={(check32BitOn64System) => onChange({ ...rule, check32BitOn64System })}
      />
    </div>
  );
}

function MsiFields({ id, n, rule, onChange }: FieldsProps<MsiDetectionRule>) {
  const checksVersion = Boolean(rule.productVersionOperator);
  return (
    <div className="space-y-2">
      <TextField
        id={`${id}-productCode`}
        label={`Rule ${n} product code`}
        value={rule.productCode}
        placeholder="{00000000-0000-0000-0000-000000000000}"
        onChange={(productCode) => onChange({ ...rule, productCode })}
      />
      <label htmlFor={`${id}-checkVersion`} className="flex items-center gap-2 text-xs text-text-secondary">
        <input
          id={`${id}-checkVersion`}
          type="checkbox"
          checked={checksVersion}
          onChange={(e) => {
            const { productVersionOperator: _op, productVersion: _v, ...rest } = rule;
            onChange(e.target.checked
              ? { ...rest, productVersionOperator: 'greaterThanOrEqual', productVersion: '' }
              : rest);
          }}
        />
        Rule {n}: also check the product version
      </label>
      {checksVersion && (
        <ComparisonFields
          id={id}
          n={n}
          operator={rule.productVersionOperator}
          value={rule.productVersion}
          valueLabel="product version"
          onOperator={(productVersionOperator) => onChange({ ...rule, productVersionOperator })}
          onValue={(productVersion) => onChange({ ...rule, productVersion })}
        />
      )}
    </div>
  );
}
