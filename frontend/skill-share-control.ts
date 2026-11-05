import { normalizeTranscendenceSkillDamageShare, parseTranscendenceSkillDamageShareInput } from './state.ts';

/** A page-owned control: read/write only its value, then notify the application's update coordinator. */
export function createSkillShareControl(getValue: () => number | undefined, setValue: (value: number) => void, onChange: () => void) {
  const skillShareControl = document.createElement('div');
  skillShareControl.className = 'skill-damage-share-control';
  const skillShareLabel = document.createElement('span');
  skillShareLabel.className = 'skill-damage-share-label';
  skillShareLabel.textContent = '超越占比';
  const skillShareOutput = document.createElement('output');
  skillShareOutput.id = 'skill-damage-share-output';
  skillShareOutput.setAttribute('aria-live', 'polite');
  const skillShareOutputLabel = document.createElement('span');
  skillShareOutputLabel.textContent = '強烈';
  const skillShareOutputValue = document.createElement('span');
  skillShareOutputValue.className = 'skill-damage-share-complement';
  const skillShareOutputPercent = document.createElement('span');
  skillShareOutputPercent.textContent = '%';
  skillShareOutput.append(skillShareOutputLabel, skillShareOutputValue, skillShareOutputPercent);
  const skillShareNumberWrap = document.createElement('div');
  skillShareNumberWrap.className = 'skill-damage-share-number-wrap';
  const skillShareNumberInput = document.createElement('input');
  skillShareNumberInput.id = 'transcendence-skill-share-number';
  skillShareNumberInput.type = 'text';
  skillShareNumberInput.inputMode = 'decimal';
  skillShareNumberInput.autocomplete = 'off';
  skillShareNumberInput.spellcheck = false;
  skillShareNumberInput.maxLength = 6;
  skillShareNumberInput.pattern = '(?:0|[1-9]\\d{0,2})(?:\\.\\d{0,2})?';
  skillShareNumberInput.setAttribute('aria-label', '超越技傷占比百分比');
  skillShareNumberInput.setAttribute('aria-describedby', 'skill-damage-share-output');
  skillShareNumberInput.title = '只接受 0–100 的數字，最多兩位小數。';
  const skillSharePercent = document.createElement('span');
  skillSharePercent.textContent = '%';
  skillShareNumberWrap.append(skillShareNumberInput, skillSharePercent);
  skillShareOutput.setAttribute('aria-label', '強烈技傷占比，自動補足至100%');
  skillShareControl.append(skillShareLabel, skillShareNumberWrap, skillShareOutput);
  const renderSkillDamageShare = (syncNumberInput = true) => {
    const share = normalizeTranscendenceSkillDamageShare(getValue());
    setValue(share);
    skillShareOutputValue.textContent = String(Math.round((100 - share) * 100) / 100);
    if (syncNumberInput) skillShareNumberInput.value = String(share);
  };
  const setSkillShareInputInvalid = (invalid: boolean) => {
    skillShareNumberInput.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    skillShareNumberWrap.classList.toggle('is-invalid', invalid);
  };
  const parseSkillShareInput = parseTranscendenceSkillDamageShareInput;
  const isSkillShareDraftValid = (raw: string) => raw === '' || parseSkillShareInput(raw) !== null;
  const isSkillShareInsertionValid = (inserted: string) => {
    const start = skillShareNumberInput.selectionStart ?? skillShareNumberInput.value.length;
    const end = skillShareNumberInput.selectionEnd ?? start;
    const nextValue = skillShareNumberInput.value.slice(0, start) + inserted + skillShareNumberInput.value.slice(end);
    return nextValue.length <= skillShareNumberInput.maxLength && isSkillShareDraftValid(nextValue);
  };
  skillShareNumberInput.addEventListener('focus', () => skillShareNumberInput.select());
  skillShareNumberInput.addEventListener('input', () => {
    const raw = skillShareNumberInput.value;
    if (raw === '') {
      setSkillShareInputInvalid(false);
      return;
    }
    const value = parseSkillShareInput(raw);
    if (value === null) {
      setSkillShareInputInvalid(true);
      renderSkillDamageShare();
      return;
    }
    setSkillShareInputInvalid(false);
    setValue(normalizeTranscendenceSkillDamageShare(value));
    renderSkillDamageShare(false);
    onChange();
  });
  const commitSkillShareNumberInput = () => {
    const value = parseSkillShareInput(skillShareNumberInput.value);
    if (value === null) {
      setSkillShareInputInvalid(true);
      renderSkillDamageShare();
      setSkillShareInputInvalid(false);
      return;
    }
    setSkillShareInputInvalid(false);
    setValue(normalizeTranscendenceSkillDamageShare(value));
    renderSkillDamageShare();
    onChange();
  };
  skillShareNumberInput.addEventListener('blur', commitSkillShareNumberInput);
  skillShareNumberInput.addEventListener('keydown', event => {
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1
      && !isSkillShareInsertionValid(event.key)) {
      event.preventDefault();
      setSkillShareInputInvalid(true);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      skillShareNumberInput.blur();
    }
  });
  skillShareNumberInput.addEventListener('beforeinput', event => {
    const inputEvent = event as InputEvent;
    if (inputEvent.inputType.startsWith('insert') && inputEvent.data !== null
      && !isSkillShareInsertionValid(inputEvent.data)) {
      event.preventDefault();
      setSkillShareInputInvalid(true);
    }
  });
  skillShareNumberInput.addEventListener('paste', event => {
    const pasted = event.clipboardData?.getData('text') ?? '';
    if (!isSkillShareInsertionValid(pasted)) {
      event.preventDefault();
      setSkillShareInputInvalid(true);
    }
  });
  renderSkillDamageShare();
  return { root: skillShareControl, render: renderSkillDamageShare };
}
