// Custom thin geometric icons — 1.25px stroke, calmer than Lucide
// All 16x16 viewBox, currentColor stroke

const Icon = ({ children, size = 16, className = '', style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 16 16"
    fill="none" stroke="currentColor" strokeWidth="1.25"
    strokeLinecap="round" strokeLinejoin="round"
    className={className} style={{ flexShrink: 0, ...style }}>
    {children}
  </svg>
);

const IconLattice = (p) => (<Icon {...p}>
  <circle cx="3" cy="3" r="1.2"/><circle cx="13" cy="3" r="1.2"/>
  <circle cx="8" cy="8" r="1.2"/>
  <circle cx="3" cy="13" r="1.2"/><circle cx="13" cy="13" r="1.2"/>
  <path d="M3.9 3.7 L7.1 7.3 M8.9 7.3 L12.1 3.7 M3.9 12.3 L7.1 8.7 M8.9 8.7 L12.1 12.3"/>
</Icon>);

const IconDashboard = (p) => (<Icon {...p}>
  <rect x="2" y="2" width="5.5" height="5.5" rx="0.8"/>
  <rect x="8.5" y="2" width="5.5" height="3" rx="0.8"/>
  <rect x="8.5" y="6" width="5.5" height="8" rx="0.8"/>
  <rect x="2" y="8.5" width="5.5" height="5.5" rx="0.8"/>
</Icon>);

const IconOrder = (p) => (<Icon {...p}>
  <path d="M4 2h6l2.5 2.5V14H4z"/>
  <path d="M10 2v2.5h2.5"/>
  <path d="M6 8h4M6 11h3"/>
</Icon>);

const IconTube = (p) => (<Icon {...p}>
  <path d="M5 1.5h6v9.5a3 3 0 0 1-6 0z"/>
  <path d="M5 8h6"/>
  <path d="M5 1.5h6"/>
</Icon>);

const IconResults = (p) => (<Icon {...p}>
  <path d="M3 2h7l3 3v9H3z"/>
  <path d="M10 2v3h3"/>
  <path d="M5.5 9.5 L7 11 L10.5 7.5"/>
</Icon>);

const IconSearch = (p) => (<Icon {...p}>
  <circle cx="7" cy="7" r="4.5"/>
  <path d="m13.5 13.5-3-3"/>
</Icon>);

const IconAccession = (p) => (<Icon {...p}>
  <rect x="2" y="3" width="12" height="10" rx="1"/>
  <path d="M5 6.5h6M5 9.5h4"/>
  <path d="M2 6h12"/>
</Icon>);

const IconList = (p) => (<Icon {...p}>
  <path d="M2 4h12M2 8h12M2 12h12"/>
  <circle cx="0.7" cy="4" r="0.4" fill="currentColor"/>
</Icon>);

const IconInstrument = (p) => (<Icon {...p}>
  <rect x="2" y="4" width="12" height="9" rx="1"/>
  <path d="M5 4V2h6v2"/>
  <circle cx="5" cy="8.5" r="1"/>
  <path d="M8 7.5h4M8 10h3"/>
</Icon>);

const IconInterface = (p) => (<Icon {...p}>
  <circle cx="3.5" cy="8" r="1.5"/>
  <circle cx="12.5" cy="3.5" r="1.5"/>
  <circle cx="12.5" cy="12.5" r="1.5"/>
  <path d="M5 8 L11 4 M5 8 L11 12"/>
</Icon>);

const IconReports = (p) => (<Icon {...p}>
  <path d="M3 2h10v12H3z"/>
  <path d="M5.5 11V8 M8 11V5.5 M10.5 11V9.5"/>
</Icon>);

const IconAdmin = (p) => (<Icon {...p}>
  <circle cx="8" cy="8" r="2"/>
  <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1 1M11.2 11.2l1 1M3.8 12.2l1-1M11.2 4.8l1-1"/>
</Icon>);

const IconRules = (p) => (<Icon {...p}>
  <circle cx="3.5" cy="4" r="1.4"/>
  <circle cx="3.5" cy="12" r="1.4"/>
  <circle cx="12.5" cy="8" r="1.4"/>
  <path d="M5 4 H9.5 a1.5 1.5 0 0 1 1.5 1.5 V7"/>
  <path d="M5 12 H9.5 a1.5 1.5 0 0 0 1.5 -1.5 V9"/>
</Icon>);

const IconBell = (p) => (<Icon {...p}>
  <path d="M3.5 11.5h9c-1-.8-1.5-2-1.5-3.5V6.5a3 3 0 0 0-6 0V8c0 1.5-.5 2.7-1.5 3.5Z"/>
  <path d="M6.5 13a1.5 1.5 0 0 0 3 0"/>
</Icon>);

const IconHelp = (p) => (<Icon {...p}>
  <circle cx="8" cy="8" r="6"/>
  <path d="M6.2 6.2a1.8 1.8 0 1 1 2.5 1.7c-.5.2-.7.6-.7 1.1V9.5"/>
  <circle cx="8" cy="11.5" r="0.4" fill="currentColor"/>
</Icon>);

const IconSliders = (p) => (<Icon {...p}>
  <path d="M2 4h8M12 4h2"/>
  <circle cx="11" cy="4" r="1.4"/>
  <path d="M2 8h2M6 8h8"/>
  <circle cx="5" cy="8" r="1.4"/>
  <path d="M2 12h6M10 12h4"/>
  <circle cx="9" cy="12" r="1.4"/>
</Icon>);

const IconSun = (p) => (<Icon {...p}>
  <circle cx="8" cy="8" r="2.6"/>
  <path d="M8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.3 3.3l1 1M11.7 11.7l1 1M3.3 12.7l1-1M11.7 4.3l1-1"/>
</Icon>);

const IconLocation = (p) => (<Icon {...p}>
  <path d="M8 14c-3-3.5-4.5-6-4.5-8.2A4.5 4.5 0 0 1 8 1.5a4.5 4.5 0 0 1 4.5 4.3C12.5 8 11 10.5 8 14Z"/>
  <circle cx="8" cy="6" r="1.5"/>
</Icon>);

const IconChevDown = (p) => (<Icon {...p}><path d="m4 6 4 4 4-4"/></Icon>);
const IconChevRight = (p) => (<Icon {...p}><path d="m6 4 4 4-4 4"/></Icon>);
const IconChevLeft = (p) => (<Icon {...p}><path d="m10 4-4 4 4 4"/></Icon>);
const IconChevUpDown = (p) => (<Icon {...p}><path d="m4 6 4-3 4 3M4 10l4 3 4-3"/></Icon>);

const IconPlus = (p) => (<Icon {...p}><path d="M8 3v10M3 8h10"/></Icon>);
const IconMinus = (p) => (<Icon {...p}><path d="M3 8h10"/></Icon>);
const IconClose = (p) => (<Icon {...p}><path d="m4 4 8 8M12 4l-8 8"/></Icon>);
const IconCheck = (p) => (<Icon {...p}><path d="m3.5 8.5 3 3 6-6"/></Icon>);
const IconMore = (p) => (<Icon {...p}>
  <circle cx="3.5" cy="8" r="0.8" fill="currentColor"/>
  <circle cx="8" cy="8" r="0.8" fill="currentColor"/>
  <circle cx="12.5" cy="8" r="0.8" fill="currentColor"/>
</Icon>);
const IconArrowRight = (p) => (<Icon {...p}><path d="M3 8h10M9 4l4 4-4 4"/></Icon>);
const IconArrowDown = (p) => (<Icon {...p}><path d="M8 3v10M4 9l4 4 4-4"/></Icon>);
const IconDrag = (p) => (<Icon {...p}>
  <circle cx="6" cy="3.5" r="0.7" fill="currentColor"/>
  <circle cx="10" cy="3.5" r="0.7" fill="currentColor"/>
  <circle cx="6" cy="8" r="0.7" fill="currentColor"/>
  <circle cx="10" cy="8" r="0.7" fill="currentColor"/>
  <circle cx="6" cy="12.5" r="0.7" fill="currentColor"/>
  <circle cx="10" cy="12.5" r="0.7" fill="currentColor"/>
</Icon>);
const IconCopy = (p) => (<Icon {...p}>
  <rect x="5" y="5" width="9" height="9" rx="1"/>
  <path d="M3 11V3a1 1 0 0 1 1-1h7"/>
</Icon>);
const IconTrash = (p) => (<Icon {...p}>
  <path d="M3 4h10M6 4V2.5h4V4M5 4l.5 9h5L11 4"/>
</Icon>);
const IconEdit = (p) => (<Icon {...p}>
  <path d="M11 2.5 13.5 5 6 12.5 3 13l.5-3z"/>
</Icon>);
const IconPlay = (p) => (<Icon {...p}><path d="M5 3v10l8-5z"/></Icon>);
const IconPause = (p) => (<Icon {...p}><path d="M5 3v10M11 3v10"/></Icon>);
const IconFlag = (p) => (<Icon {...p}>
  <path d="M3.5 14V2.5h8L9 6l2.5 3.5h-8"/>
</Icon>);
const IconFilter = (p) => (<Icon {...p}>
  <path d="M2 3h12L9.5 8.5V13L6.5 14V8.5z"/>
</Icon>);
const IconSort = (p) => (<Icon {...p}>
  <path d="M4 3v10M2 11l2 2 2-2 M12 13V3M10 5l2-2 2 2"/>
</Icon>);
const IconSettings2 = (p) => (<Icon {...p}>
  <path d="M2 4h6M11 4h3M2 12h3M8 12h6"/>
  <circle cx="9.5" cy="4" r="1.5"/>
  <circle cx="6.5" cy="12" r="1.5"/>
</Icon>);
const IconClock = (p) => (<Icon {...p}>
  <circle cx="8" cy="8" r="6"/>
  <path d="M8 4.5V8l2.5 1.5"/>
</Icon>);
const IconBranch = (p) => (<Icon {...p}>
  <circle cx="4" cy="3.5" r="1.3"/>
  <circle cx="4" cy="12.5" r="1.3"/>
  <circle cx="12" cy="6" r="1.3"/>
  <path d="M4 5v6"/>
  <path d="M4 7c0-1.5 1-2 3-2.5 1.5-.4 2.5-.9 3-2"/>
</Icon>);
const IconTag = (p) => (<Icon {...p}>
  <path d="M2 8V2.5h5.5L14 9l-5 5z"/>
  <circle cx="5" cy="5" r="0.7" fill="currentColor"/>
</Icon>);
const IconGrid = (p) => (<Icon {...p}>
  <rect x="2" y="2" width="5" height="5" rx="0.5"/>
  <rect x="9" y="2" width="5" height="5" rx="0.5"/>
  <rect x="2" y="9" width="5" height="5" rx="0.5"/>
  <rect x="9" y="9" width="5" height="5" rx="0.5"/>
</Icon>);
const IconLayers = (p) => (<Icon {...p}>
  <path d="m8 2 6 3-6 3-6-3z"/>
  <path d="m2 8 6 3 6-3"/>
  <path d="m2 11 6 3 6-3"/>
</Icon>);
const IconBeaker = (p) => (<Icon {...p}>
  <path d="M6 1.5h4v4l3 6.5a1.5 1.5 0 0 1-1.4 2H4.4a1.5 1.5 0 0 1-1.4-2L6 5.5z"/>
  <path d="M6 1.5h4"/>
  <path d="M4.5 9h7"/>
</Icon>);
const IconBolt = (p) => (<Icon {...p}>
  <path d="M9 1.5 3.5 9H7.5L7 14.5 12.5 7H8.5z"/>
</Icon>);
const IconArchive = (p) => (<Icon {...p}>
  <rect x="2" y="3" width="12" height="3" rx="0.5"/>
  <path d="M3 6v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6"/>
  <path d="M6.5 9h3"/>
</Icon>);
const IconLink = (p) => (<Icon {...p}>
  <path d="M7 9l2-2"/>
  <path d="M9 4.5 10.5 3a2 2 0 0 1 2.8 2.8L11.5 7.5"/>
  <path d="M7 11.5 5.5 13a2 2 0 0 1-2.8-2.8L4.5 8.5"/>
</Icon>);
const IconPower = (p) => (<Icon {...p}>
  <path d="M5 4.5a5 5 0 1 0 6 0"/>
  <path d="M8 2v6"/>
</Icon>);
const IconInbox = (p) => (<Icon {...p}>
  <path d="M2 9 4 3h8l2 6"/>
  <path d="M2 9v4h12V9h-4l-1 1.5H7L6 9z"/>
</Icon>);
const IconUser = (p) => (<Icon {...p}>
  <circle cx="8" cy="5.5" r="2.5"/>
  <path d="M3 14c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5"/>
</Icon>);
const IconShield = (p) => (<Icon {...p}>
  <path d="M8 1.5 3 3.5V8c0 3 2 5.5 5 6.5 3-1 5-3.5 5-6.5V3.5z"/>
</Icon>);
const IconBook = (p) => (<Icon {...p}>
  <path d="M3 2.5h4.5a2 2 0 0 1 2 2V14a1.5 1.5 0 0 0-1.5-1.5H3z"/>
  <path d="M13 2.5H8.5a2 2 0 0 0-2 2V14a1.5 1.5 0 0 1 1.5-1.5H13z"/>
</Icon>);
const IconLabel = (p) => (<Icon {...p}>
  <rect x="2.5" y="3.5" width="11" height="9" rx="1"/>
  <path d="M5 6.5h6M5 9h4"/>
</Icon>);
const IconMap = (p) => (<Icon {...p}>
  <path d="M2 3.5 6 2l4 1.5 4-1.5v10L10 14l-4-1.5L2 14z"/>
  <path d="M6 2v10.5M10 3.5V14"/>
</Icon>);

Object.assign(window, {
  IconLattice, IconDashboard, IconOrder, IconTube, IconResults, IconSearch,
  IconAccession, IconList, IconInstrument, IconInterface, IconReports, IconAdmin,
  IconRules, IconBell, IconHelp, IconSliders, IconSun, IconLocation,
  IconChevDown, IconChevRight, IconChevLeft, IconChevUpDown,
  IconPlus, IconMinus, IconClose, IconCheck, IconMore, IconArrowRight, IconArrowDown,
  IconDrag, IconCopy, IconTrash, IconEdit, IconPlay, IconPause, IconFlag, IconFilter,
  IconSort, IconSettings2, IconClock, IconBranch, IconTag, IconGrid, IconLayers,
  IconBeaker, IconBolt, IconArchive, IconLink, IconPower, IconInbox, IconUser,
  IconShield, IconBook, IconLabel, IconMap,
});
