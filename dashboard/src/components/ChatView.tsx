import { useEffect, useRef } from 'react';

interface Message {
  content: string;
  contentType: string;
  sendTime: number;
  fromUserId: string;
  roleType: string;
  nickName: string;
}

interface Props {
  messages: Message[];
  myUserId: string;
}

const BYBIT_CDN = 'https://api.bybit.com';

function resolveImageUrl(content: string): string | null {
  if (content.startsWith('http')) return content;
  if (content.startsWith('/fiat/')) return `${BYBIT_CDN}${content}`;
  return null;
}

export default function ChatView({ messages, myUserId }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="flex flex-col h-full overflow-y-auto space-y-2 pr-1">
      {messages
        .filter((m) => m.roleType !== 'sys')
        .map((m, i) => {
          const isMe = m.fromUserId === myUserId;
          const isImage = m.contentType === 'pic' || m.contentType === '2';
          const imageUrl = isImage ? resolveImageUrl(m.content) : null;

          return (
            <div key={i} className={`max-w-[85%] ${isMe ? '' : 'ml-auto'}`}>
              <div className={`rounded-lg px-3 py-2 text-sm ${isMe ? 'bg-surface' : 'bg-green-950/40'}`}>
                <div className={`text-[11px] ${isMe ? 'text-blue-400' : 'text-green-400'}`}>
                  {isMe ? 'You' : m.nickName}
                </div>
                {isImage ? (
                  imageUrl ? (
                    <a href={imageUrl} target="_blank" rel="noopener noreferrer">
                      <img src={imageUrl} alt="chat image" className="mt-1 rounded max-w-full max-h-48 object-contain" />
                    </a>
                  ) : (
                    <span className="text-text-faint italic">[Image]</span>
                  )
                ) : (
                  <div className="text-text mt-0.5">{m.content}</div>
                )}
              </div>
            </div>
          );
        })}
      <div ref={bottomRef} />
    </div>
  );
}
