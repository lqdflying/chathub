import { FC } from 'react';

// Sanitize JSON string for safe embedding in a <script> tag.
// JSON.stringify alone does not escape </script> or HTML comments,
// which can allow XSS via premature script-tag termination.
const safeJsonLd = (ld: object): string =>
  JSON.stringify(ld)
    .replaceAll('</', '<\\/')
    .replaceAll('<!--', '<\\!--')
    .replaceAll('-->', '-\\->');

const StructuredData: FC<{ ld: any }> = ({ ld }) => {
  return (
    <script
      // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
      dangerouslySetInnerHTML={{ __html: safeJsonLd(ld) }}
      id="structured-data"
      type="application/ld+json"
    />
  );
};
export default StructuredData;
