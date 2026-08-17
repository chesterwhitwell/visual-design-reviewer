import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement>;

function base(props: Props): Props {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 1.8,
    "aria-hidden": true,
    ...props,
  };
}

export function ArrowLeftIcon(props: Props) {
  return <svg {...base(props)}><path d="M19 12H5m6 6-6-6 6-6" /></svg>;
}

export function UploadIcon(props: Props) {
  return <svg {...base(props)}><path d="M12 16V4m-5 5 5-5 5 5M5 20h14" /></svg>;
}

export function TrashIcon(props: Props) {
  return <svg {...base(props)}><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>;
}

export function ChevronUpIcon(props: Props) {
  return <svg {...base(props)}><path d="m6 15 6-6 6 6" /></svg>;
}

export function ChevronDownIcon(props: Props) {
  return <svg {...base(props)}><path d="m6 9 6 6 6-6" /></svg>;
}

export function ImageIcon(props: Props) {
  return <svg {...base(props)}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m4 17 4.5-4.5 3.2 3.2 2.2-2.2L20 19" /></svg>;
}

export function SparklesIcon(props: Props) {
  return <svg {...base(props)}><path d="m12 3 1.1 3.4L16.5 7.5l-3.4 1.1L12 12l-1.1-3.4-3.4-1.1 3.4-1.1L12 3Z" /><path d="m18 13 .8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8L18 13ZM6 12l.7 2.3L9 15l-2.3.7L6 18l-.7-2.3L3 15l2.3-.7L6 12Z" /></svg>;
}

export function PlusIcon(props: Props) {
  return <svg {...base(props)}><path d="M12 5v14M5 12h14" /></svg>;
}

export function DownloadIcon(props: Props) {
  return <svg {...base(props)}><path d="M12 3v12m-5-5 5 5 5-5M5 20h14" /></svg>;
}

export function CloseIcon(props: Props) {
  return <svg {...base(props)}><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

export function CheckIcon(props: Props) {
  return <svg {...base(props)}><path d="m5 12 4 4L19 6" /></svg>;
}

export function AlertIcon(props: Props) {
  return <svg {...base(props)}><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v4m0 3h.01" /></svg>;
}

export function MoreIcon(props: Props) {
  return <svg {...base(props)}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></svg>;
}
