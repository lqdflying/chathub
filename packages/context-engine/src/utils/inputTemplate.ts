import { template } from 'lodash-es';

/** Same interpolate grammar as `InputTemplateProcessor`. */
export const USER_INPUT_TEMPLATE_INTERPOLATE = /{{\s*(text)\s*}}/g;

export const compileUserInputTemplate = (inputTemplate: string) =>
  template(inputTemplate, { interpolate: USER_INPUT_TEMPLATE_INTERPOLATE });

/** Apply a per-user `{{text}}` template, or return the original content on failure. */
export const applyUserInputTemplate = (
  inputTemplate: string | undefined,
  content: string,
): string => {
  if (!inputTemplate) return content;

  try {
    const rendered = compileUserInputTemplate(inputTemplate)({ text: content });
    return typeof rendered === 'string' ? rendered : content;
  } catch {
    return content;
  }
};
