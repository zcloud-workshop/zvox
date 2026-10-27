export function Icon({
  name,
}: {
  name: 'studio' | 'jobs' | 'user' | 'settings' | 'arrow' | 'search' | 'plaza' | 'voice'
}) {
  const paths = {
    studio: 'M4 10v4m4-9v14m4-16v18m4-16v14m4-9v4',
    jobs: 'M5 3h10l4 4v14H5z M9 11h6m-6 4h6M14 3v5h5',
    user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',
    settings: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    search: 'M16 16l5 5M18 10A8 8 0 1 1 2 10a8 8 0 0 1 16 0',
    plaza: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    voice: 'M3 11v2m4-7v12m4-15v18m4-15v12m4-7v2',
  }
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
