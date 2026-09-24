import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 24, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 11l8-7 8 7" />
    <path d="M6 10v10h12V10" />
  </Icon>
)

export const MicIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </Icon>
)

export const MembersIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M16.5 14.2c2.6.5 4.5 2.8 4.5 5.8" />
  </Icon>
)

export const OverviewIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </Icon>
)

export const InboxIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 13l2.5-8h11L20 13" />
    <path d="M4 13v6h16v-6h-5l-1 2h-4l-1-2z" />
  </Icon>
)

export const ExportIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 3h7l5 5v13H7z" />
    <path d="M14 3v5h5" />
    <path d="M12 11v6" />
    <path d="M9.5 14.5L12 17l2.5-2.5" />
  </Icon>
)

export const PlusIcon = (p: IconProps) => (
  <Icon strokeWidth={2} {...p}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Icon>
)
