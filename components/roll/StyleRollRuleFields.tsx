import React from 'react';
import { t } from '../../services/i18n';
import { ROLL_MAX_ARTISTS, type RollRules } from '../../services/styleRoll';
import { TOOLBAR_FIELD_CLASS } from '../ToolbarPopover';

export const StyleRollRuleFields: React.FC<{ rules: RollRules; onChange: (rules: RollRules) => void; disabled?: boolean }> = ({ rules, onChange, disabled }) => <div className="space-y-3">
  {([
    ['每串人数范围', [['minArtists', '最少画师人数'], ['maxArtists', '最多画师人数']], 1, ROLL_MAX_ARTISTS, 1],
    ['权重范围', [['minWeight', '最低权重'], ['maxWeight', '最高权重']], 0.1, 3, 0.1],
  ] as const).map(([title, fields, min, max, step]) => <fieldset key={title} disabled={disabled}>
    <legend className="sr-only">{t(title)}</legend>
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3">
      <span aria-hidden="true" className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t(title)}</span>
      <div className="grid min-w-0 grid-cols-[1fr_auto_1fr] items-center gap-1.5">
        {fields.map(([key, label], index) => <React.Fragment key={key}>{index > 0 && <span aria-hidden="true" className="text-gray-400">—</span>}<input type="number" aria-label={t(label)} className={`${TOOLBAR_FIELD_CLASS} !px-2 text-center tabular-nums`} min={min} max={max} step={step} value={rules[key]} onChange={event => onChange({ ...rules, [key]: Number(event.target.value) })} /></React.Fragment>)}
      </div>
    </div>
  </fieldset>)}
</div>;
