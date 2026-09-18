import { useTranslation } from 'react-i18next';

import AssistantStatusRow from './AssistantStatusRow';

const IntentUnderstanding = () => {
  const { t } = useTranslation('chat');

  return <AssistantStatusRow title={t('intentUnderstanding.title')} />;
};
export default IntentUnderstanding;
