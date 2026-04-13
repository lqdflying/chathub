import Image from 'next/image';

interface WebFaviconProps {
  alt?: string;
  size?: number;
  title?: string;
  url: string;
}

const WebFavicon = ({ url, title, alt, size = 14 }: WebFaviconProps) => {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }

  return (
    <Image
      alt={alt || title || url}
      height={size}
      src={`https://icons.duckduckgo.com/ip3/${host}.ico`}
      style={{ borderRadius: 4 }}
      unoptimized
      width={size}
    />
  );
};

export default WebFavicon;
