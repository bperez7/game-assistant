import type { CSSProperties } from 'react';
export function Icon({
  name,
  size = 20,
  style
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  const paths: Record<string, React.ReactNode> = {
    compass: <>
    <circle cx="12" cy="12" r="9" />
    <path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z" />
  </>,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m16 16 4 4" />
  </>,
    arrow: <path d="M12 19V5m-6 6 6-6 6 6" />,
    book: <>
    <path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1ZM12 5v15" />
  </>,
    link: <>
    <path d="m10 14 4-4m-6 2-2 2a3 3 0 0 0 4 4l3-3m-2-6 3-3a3 3 0 0 1 4 4l-2 2" />
  </>,
    external: <>
    <path d="M14 3h7v7m0-7L11 13M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
  </>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    settings: <>
    <path d="M4 7h16M4 17h16" />
    <circle cx="9" cy="7" r="3" />
    <circle cx="15" cy="17" r="3" />
  </>,
    spark: <>
    <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
  </>,
    chevron: <path d="m9 5 7 7-7 7" />,
    trash: <>
    <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />
  </>,
    check: <path d="m5 12 4 4L19 6" />,
    flag: <>
    <path d="M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0" />
  </>,
    shield: <>
    <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
    <path d="m8 12 3 3 5-6" />
  </>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name] || paths.compass}</svg>;
}
