import Conversation from './features/Conversation';
import Essential from './features/Essential';

const Page = () => {
  return (
    <>
      <Essential />
      <Conversation />
    </>
  );
};

Page.displayName = 'HotkeySetting';

export default Page;
