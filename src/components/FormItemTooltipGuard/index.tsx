'use client';

import { memo, useEffect } from 'react';

import { attachFormItemTooltipGuard } from './attach';

/**
 * Keeps native Form.Item help-icon clicks from toggling adjacent Switches.
 * Mount once at the app shell (see AppTheme).
 */
const FormItemTooltipGuard = memo(() => {
  useEffect(() => attachFormItemTooltipGuard(), []);

  return null;
});

FormItemTooltipGuard.displayName = 'FormItemTooltipGuard';

export default FormItemTooltipGuard;
