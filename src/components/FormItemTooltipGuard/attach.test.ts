import { afterEach, describe, expect, it } from 'vitest';

import { attachFormItemTooltipGuard, isNativeFormItemTooltipEventTarget } from './attach';

describe('formItemTooltipGuard', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('detects native Form.Item tooltip targets (including SVG children)', () => {
    document.body.innerHTML = `
      <label>
        Topic snippets
        <span class="ant-form-item-tooltip"><svg><path /></svg></span>
      </label>
      <button type="button">elsewhere</button>
    `;

    const path = document.querySelector('path');
    const button = document.querySelector('button');

    expect(isNativeFormItemTooltipEventTarget(path)).toBe(true);
    expect(isNativeFormItemTooltipEventTarget(button)).toBe(false);
  });

  it('preventDefaults mousedown and click on the help icon', () => {
    document.body.innerHTML = `
      <label>
        <span class="ant-form-item-tooltip" id="help">?</span>
      </label>
    `;

    const detach = attachFormItemTooltipGuard();
    const help = document.getElementById('help')!;

    for (const type of ['mousedown', 'click'] as const) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true });
      help.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }

    detach();
  });

  it('does not preventDefault clicks outside the help icon', () => {
    document.body.innerHTML = `
      <label id="row">
        Topic snippets
        <span class="ant-form-item-tooltip">?</span>
      </label>
    `;

    const detach = attachFormItemTooltipGuard();
    const label = document.getElementById('row')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    label.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);

    detach();
  });
});
