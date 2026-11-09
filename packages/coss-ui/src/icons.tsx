import type { LucideIcon } from "lucide-react";
import {
  ActivityIcon as LucideActivityIcon,
  ArrowDownIcon as LucideArrowDownIcon,
  ArrowLeftIcon as LucideArrowLeftIcon,
  ArrowRightIcon as LucideArrowRightIcon,
  ArrowUpIcon as LucideArrowUpIcon,
  ArrowUpRightIcon as LucideArrowUpRightIcon,
  AsteriskIcon as LucideAsteriskIcon,
  AtomIcon as LucideAtomIcon,
  AtSignIcon as LucideAtSignIcon,
  BadgeCheckIcon as LucideBadgeCheckIcon,
  BanIcon as LucideBanIcon,
  BellIcon as LucideBellIcon,
  BinaryIcon as LucideBinaryIcon,
  BlocksIcon as LucideBlocksIcon,
  BoldIcon as LucideBoldIcon,
  BookIcon as LucideBookIcon,
  BookmarkIcon as LucideBookmarkIcon,
  BookOpenCheckIcon as LucideBookOpenCheckIcon,
  BookOpenIcon as LucideBookOpenIcon,
  BookUserIcon as LucideBookUserIcon,
  BuildingIcon as LucideBuildingIcon,
  CalendarCheck2Icon as LucideCalendarCheck2Icon,
  CalendarDaysIcon as LucideCalendarDaysIcon,
  CalendarHeartIcon as LucideCalendarHeartIcon,
  CalendarIcon as LucideCalendarIcon,
  CalendarRangeIcon as LucideCalendarRangeIcon,
  CalendarSearchIcon as LucideCalendarSearchIcon,
  CalendarX2Icon as LucideCalendarX2Icon,
  ChartBarIcon as LucideChartBarIcon,
  ChartLineIcon as LucideChartLineIcon,
  CheckCheckIcon as LucideCheckCheckIcon,
  CheckIcon as LucideCheckIcon,
  ChevronDownIcon as LucideChevronDownIcon,
  ChevronLeftIcon as LucideChevronLeftIcon,
  ChevronRightIcon as LucideChevronRightIcon,
  ChevronsDownUpIcon as LucideChevronsDownUpIcon,
  ChevronsLeftIcon as LucideChevronsLeftIcon,
  ChevronsRightIcon as LucideChevronsRightIcon,
  ChevronsUpDownIcon as LucideChevronsUpDownIcon,
  ChevronUpIcon as LucideChevronUpIcon,
  CircleAlertIcon as LucideCircleAlertIcon,
  CircleArrowUpIcon as LucideCircleArrowUpIcon,
  CircleCheckBigIcon as LucideCircleCheckBigIcon,
  CircleCheckIcon as LucideCircleCheckIcon,
  CircleHelpIcon as LucideCircleHelpIcon,
  CircleIcon as LucideCircleIcon,
  CirclePlusIcon as LucideCirclePlusIcon,
  CircleXIcon as LucideCircleXIcon,
  ClipboardCheckIcon as LucideClipboardCheckIcon,
  ClipboardIcon as LucideClipboardIcon,
  ClockIcon as LucideClockIcon,
  CodeIcon as LucideCodeIcon,
  Columns3Icon as LucideColumns3Icon,
  CommandIcon as LucideCommandIcon,
  ContactIcon as LucideContactIcon,
  CopyIcon as LucideCopyIcon,
  CornerDownLeftIcon as LucideCornerDownLeftIcon,
  CornerDownRightIcon as LucideCornerDownRightIcon,
  CreditCardIcon as LucideCreditCardIcon,
  DiscIcon as LucideDiscIcon,
  DotIcon as LucideDotIcon,
  DownloadIcon as LucideDownloadIcon,
  EllipsisIcon as LucideEllipsisIcon,
  EllipsisVerticalIcon as LucideEllipsisVerticalIcon,
  ExternalLinkIcon as LucideExternalLinkIcon,
  EyeIcon as LucideEyeIcon,
  EyeOffIcon as LucideEyeOffIcon,
  FileDownIcon as LucideFileDownIcon,
  FileIcon as LucideFileIcon,
  FileTextIcon as LucideFileTextIcon,
  FilterIcon as LucideFilterIcon,
  FingerprintIcon as LucideFingerprintIcon,
  FlagIcon as LucideFlagIcon,
  FolderIcon as LucideFolderIcon,
  GiftIcon as LucideGiftIcon,
  GitMergeIcon as LucideGitMergeIcon,
  GlobeIcon as LucideGlobeIcon,
  Grid3x3Icon as LucideGrid3x3Icon,
  HandshakeIcon as LucideHandshakeIcon,
  InfoIcon as LucideInfoIcon,
  ItalicIcon as LucideItalicIcon,
  KeyIcon as LucideKeyIcon,
  LayersIcon as LucideLayersIcon,
  LayoutDashboardIcon as LucideLayoutDashboardIcon,
  Link2Icon as LucideLink2Icon,
  LinkIcon as LucideLinkIcon,
  ListFilterIcon as LucideListFilterIcon,
  LoaderIcon as LucideLoaderIcon,
  LockIcon as LucideLockIcon,
  LockOpenIcon as LucideLockOpenIcon,
  LogOutIcon as LucideLogOutIcon,
  MailIcon as LucideMailIcon,
  MailOpenIcon as LucideMailOpenIcon,
  MapIcon as LucideMapIcon,
  MapPinIcon as LucideMapPinIcon,
  MenuIcon as LucideMenuIcon,
  MessageCircleIcon as LucideMessageCircleIcon,
  MessagesSquareIcon as LucideMessagesSquareIcon,
  MicIcon as LucideMicIcon,
  MicOffIcon as LucideMicOffIcon,
  MonitorIcon as LucideMonitorIcon,
  MoonIcon as LucideMoonIcon,
  PaintbrushIcon as LucidePaintbrushIcon,
  PaperclipIcon as LucidePaperclipIcon,
  PauseIcon as LucidePauseIcon,
  PencilIcon as LucidePencilIcon,
  PhoneCallIcon as LucidePhoneCallIcon,
  PhoneIcon as LucidePhoneIcon,
  PhoneIncomingIcon as LucidePhoneIncomingIcon,
  PhoneOffIcon as LucidePhoneOffIcon,
  PhoneOutgoingIcon as LucidePhoneOutgoingIcon,
  PlayIcon as LucidePlayIcon,
  PlusIcon as LucidePlusIcon,
  RefreshCcwIcon as LucideRefreshCcwIcon,
  RefreshCwIcon as LucideRefreshCwIcon,
  RepeatIcon as LucideRepeatIcon,
  RocketIcon as LucideRocketIcon,
  RotateCcwIcon as LucideRotateCcwIcon,
  RotateCwIcon as LucideRotateCwIcon,
  SearchIcon as LucideSearchIcon,
  SendIcon as LucideSendIcon,
  SettingsIcon as LucideSettingsIcon,
  Share2Icon as LucideShare2Icon,
  ShieldCheckIcon as LucideShieldCheckIcon,
  ShieldIcon as LucideShieldIcon,
  ShuffleIcon as LucideShuffleIcon,
  SlidersHorizontalIcon as LucideSlidersHorizontalIcon,
  SlidersVerticalIcon as LucideSlidersVerticalIcon,
  SmartphoneIcon as LucideSmartphoneIcon,
  SparklesIcon as LucideSparklesIcon,
  SplitIcon as LucideSplitIcon,
  SquareCheckIcon as LucideSquareCheckIcon,
  SquarePenIcon as LucideSquarePenIcon,
  StarIcon as LucideStarIcon,
  SunIcon as LucideSunIcon,
  SunriseIcon as LucideSunriseIcon,
  SunsetIcon as LucideSunsetIcon,
  TagsIcon as LucideTagsIcon,
  TerminalIcon as LucideTerminalIcon,
  Trash2Icon as LucideTrash2Icon,
  TrashIcon as LucideTrashIcon,
  TriangleAlertIcon as LucideTriangleAlertIcon,
  UploadIcon as LucideUploadIcon,
  UserCheckIcon as LucideUserCheckIcon,
  UserIcon as LucideUserIcon,
  UserPlusIcon as LucideUserPlusIcon,
  UsersIcon as LucideUsersIcon,
  UserXIcon as LucideUserXIcon,
  VenetianMaskIcon as LucideVenetianMaskIcon,
  VideoIcon as LucideVideoIcon,
  WaypointsIcon as LucideWaypointsIcon,
  WebhookIcon as LucideWebhookIcon,
  XIcon as LucideXIcon,
  ZapIcon as LucideZapIcon,
} from "lucide-react";

export interface IconProps {
  size?: number;
  className?: string;
  onClick?: () => void;
}

function createIcon(Icon: LucideIcon, testId: string) {
  return function WrappedIcon({ size = 16, className, onClick }: IconProps) {
    return <Icon size={size} className={className} onClick={onClick} data-testid={testId} />;
  };
}

export const ActivityIcon = /*#__PURE__*/ createIcon(LucideActivityIcon, "activity-icon");
export const ArrowDownIcon = /*#__PURE__*/ createIcon(LucideArrowDownIcon, "arrow-down-icon");
export const ArrowLeftIcon = /*#__PURE__*/ createIcon(LucideArrowLeftIcon, "arrow-left-icon");
export const ArrowRightIcon = /*#__PURE__*/ createIcon(LucideArrowRightIcon, "arrow-right-icon");
export const ArrowUpRightIcon = /*#__PURE__*/ createIcon(LucideArrowUpRightIcon, "arrow-up-right-icon");
export const ArrowUpIcon = /*#__PURE__*/ createIcon(LucideArrowUpIcon, "arrow-up-icon");
export const AsteriskIcon = /*#__PURE__*/ createIcon(LucideAsteriskIcon, "asterisk-icon");
export const AtSignIcon = /*#__PURE__*/ createIcon(LucideAtSignIcon, "at-sign-icon");
export const AtomIcon = /*#__PURE__*/ createIcon(LucideAtomIcon, "atom-icon");
export const BadgeCheckIcon = /*#__PURE__*/ createIcon(LucideBadgeCheckIcon, "badge-check-icon");
export const BanIcon = /*#__PURE__*/ createIcon(LucideBanIcon, "ban-icon");
export const BellIcon = /*#__PURE__*/ createIcon(LucideBellIcon, "bell-icon");
export const BinaryIcon = /*#__PURE__*/ createIcon(LucideBinaryIcon, "binary-icon");
export const BlocksIcon = /*#__PURE__*/ createIcon(LucideBlocksIcon, "blocks-icon");
export const BoldIcon = /*#__PURE__*/ createIcon(LucideBoldIcon, "bold-icon");
export const BookOpenCheckIcon = /*#__PURE__*/ createIcon(LucideBookOpenCheckIcon, "book-open-check-icon");
export const BookOpenIcon = /*#__PURE__*/ createIcon(LucideBookOpenIcon, "book-open-icon");
export const BookUserIcon = /*#__PURE__*/ createIcon(LucideBookUserIcon, "book-user-icon");
export const BookIcon = /*#__PURE__*/ createIcon(LucideBookIcon, "book-icon");
export const BookmarkIcon = /*#__PURE__*/ createIcon(LucideBookmarkIcon, "bookmark-icon");
export const BuildingIcon = /*#__PURE__*/ createIcon(LucideBuildingIcon, "building-icon");
export const CalendarCheck2Icon = /*#__PURE__*/ createIcon(LucideCalendarCheck2Icon, "calendar-check-2-icon");
export const CalendarDaysIcon = /*#__PURE__*/ createIcon(LucideCalendarDaysIcon, "calendar-days-icon");
export const CalendarHeartIcon = /*#__PURE__*/ createIcon(LucideCalendarHeartIcon, "calendar-heart-icon");
export const CalendarRangeIcon = /*#__PURE__*/ createIcon(LucideCalendarRangeIcon, "calendar-range-icon");
export const CalendarSearchIcon = /*#__PURE__*/ createIcon(LucideCalendarSearchIcon, "calendar-search-icon");
export const CalendarX2Icon = /*#__PURE__*/ createIcon(LucideCalendarX2Icon, "calendar-x-2-icon");
export const CalendarIcon = /*#__PURE__*/ createIcon(LucideCalendarIcon, "calendar-icon");
export const ChartBarIcon = /*#__PURE__*/ createIcon(LucideChartBarIcon, "chart-bar-icon");
export const ChartLineIcon = /*#__PURE__*/ createIcon(LucideChartLineIcon, "chart-line-icon");
export const CheckCheckIcon = /*#__PURE__*/ createIcon(LucideCheckCheckIcon, "check-check-icon");
export const CheckIcon = /*#__PURE__*/ createIcon(LucideCheckIcon, "check-icon");
export const ChevronDownIcon = /*#__PURE__*/ createIcon(LucideChevronDownIcon, "chevron-down-icon");
export const ChevronLeftIcon = /*#__PURE__*/ createIcon(LucideChevronLeftIcon, "chevron-left-icon");
export const ChevronRightIcon = /*#__PURE__*/ createIcon(LucideChevronRightIcon, "chevron-right-icon");
export const ChevronUpIcon = /*#__PURE__*/ createIcon(LucideChevronUpIcon, "chevron-up-icon");
export const ChevronsDownUpIcon = /*#__PURE__*/ createIcon(LucideChevronsDownUpIcon, "chevrons-down-up-icon");
export const ChevronsLeftIcon = /*#__PURE__*/ createIcon(LucideChevronsLeftIcon, "chevrons-left-icon");
export const ChevronsRightIcon = /*#__PURE__*/ createIcon(LucideChevronsRightIcon, "chevrons-right-icon");
export const ChevronsUpDownIcon = /*#__PURE__*/ createIcon(LucideChevronsUpDownIcon, "chevrons-up-down-icon");
export const CircleAlertIcon = /*#__PURE__*/ createIcon(LucideCircleAlertIcon, "circle-alert-icon");
export const CircleArrowUpIcon = /*#__PURE__*/ createIcon(LucideCircleArrowUpIcon, "circle-arrow-up-icon");
export const CircleCheckBigIcon = /*#__PURE__*/ createIcon(LucideCircleCheckBigIcon, "circle-check-big-icon");
export const CircleCheckIcon = /*#__PURE__*/ createIcon(LucideCircleCheckIcon, "circle-check-icon");
export const CircleHelpIcon = /*#__PURE__*/ createIcon(LucideCircleHelpIcon, "circle-help-icon");
export const CirclePlusIcon = /*#__PURE__*/ createIcon(LucideCirclePlusIcon, "circle-plus-icon");
export const CircleXIcon = /*#__PURE__*/ createIcon(LucideCircleXIcon, "circle-x-icon");
export const CircleIcon = /*#__PURE__*/ createIcon(LucideCircleIcon, "circle-icon");
export const ClipboardCheckIcon = /*#__PURE__*/ createIcon(LucideClipboardCheckIcon, "clipboard-check-icon");
export const ClipboardIcon = /*#__PURE__*/ createIcon(LucideClipboardIcon, "clipboard-icon");
export const ClockIcon = /*#__PURE__*/ createIcon(LucideClockIcon, "clock-icon");
export const CodeIcon = /*#__PURE__*/ createIcon(LucideCodeIcon, "code-icon");
export const Columns3Icon = /*#__PURE__*/ createIcon(LucideColumns3Icon, "columns-3-icon");
export const CommandIcon = /*#__PURE__*/ createIcon(LucideCommandIcon, "command-icon");
export const ContactIcon = /*#__PURE__*/ createIcon(LucideContactIcon, "contact-icon");
export const CopyIcon = /*#__PURE__*/ createIcon(LucideCopyIcon, "copy-icon");
export const CornerDownLeftIcon = /*#__PURE__*/ createIcon(LucideCornerDownLeftIcon, "corner-down-left-icon");
export const CornerDownRightIcon = /*#__PURE__*/ createIcon(LucideCornerDownRightIcon, "corner-down-right-icon");
export const CreditCardIcon = /*#__PURE__*/ createIcon(LucideCreditCardIcon, "credit-card-icon");
export const DiscIcon = /*#__PURE__*/ createIcon(LucideDiscIcon, "disc-icon");
export const DotIcon = /*#__PURE__*/ createIcon(LucideDotIcon, "dot-icon");
export const DownloadIcon = /*#__PURE__*/ createIcon(LucideDownloadIcon, "download-icon");
export const EllipsisVerticalIcon = /*#__PURE__*/ createIcon(LucideEllipsisVerticalIcon, "ellipsis-vertical-icon");
export const EllipsisIcon = /*#__PURE__*/ createIcon(LucideEllipsisIcon, "ellipsis-icon");
export const ExternalLinkIcon = /*#__PURE__*/ createIcon(LucideExternalLinkIcon, "external-link-icon");
export const EyeOffIcon = /*#__PURE__*/ createIcon(LucideEyeOffIcon, "eye-off-icon");
export const EyeIcon = /*#__PURE__*/ createIcon(LucideEyeIcon, "eye-icon");
export const FileDownIcon = /*#__PURE__*/ createIcon(LucideFileDownIcon, "file-down-icon");
export const FileTextIcon = /*#__PURE__*/ createIcon(LucideFileTextIcon, "file-text-icon");
export const FileIcon = /*#__PURE__*/ createIcon(LucideFileIcon, "file-icon");
export const FilterIcon = /*#__PURE__*/ createIcon(LucideFilterIcon, "filter-icon");
export const FingerprintIcon = /*#__PURE__*/ createIcon(LucideFingerprintIcon, "fingerprint-icon");
export const FlagIcon = /*#__PURE__*/ createIcon(LucideFlagIcon, "flag-icon");
export const FolderIcon = /*#__PURE__*/ createIcon(LucideFolderIcon, "folder-icon");
export const GiftIcon = /*#__PURE__*/ createIcon(LucideGiftIcon, "gift-icon");
export const GitMergeIcon = /*#__PURE__*/ createIcon(LucideGitMergeIcon, "git-merge-icon");
export const GlobeIcon = /*#__PURE__*/ createIcon(LucideGlobeIcon, "globe-icon");
export const Grid3x3Icon = /*#__PURE__*/ createIcon(LucideGrid3x3Icon, "grid-3x3-icon");
export const HandshakeIcon = /*#__PURE__*/ createIcon(LucideHandshakeIcon, "handshake-icon");
export const InfoIcon = /*#__PURE__*/ createIcon(LucideInfoIcon, "info-icon");
export const ItalicIcon = /*#__PURE__*/ createIcon(LucideItalicIcon, "italic-icon");
export const KeyIcon = /*#__PURE__*/ createIcon(LucideKeyIcon, "key-icon");
export const LayersIcon = /*#__PURE__*/ createIcon(LucideLayersIcon, "layers-icon");
export const LayoutDashboardIcon = /*#__PURE__*/ createIcon(LucideLayoutDashboardIcon, "layout-dashboard-icon");
export const Link2Icon = /*#__PURE__*/ createIcon(LucideLink2Icon, "link-2-icon");
export const LinkIcon = /*#__PURE__*/ createIcon(LucideLinkIcon, "link-icon");
export const ListFilterIcon = /*#__PURE__*/ createIcon(LucideListFilterIcon, "list-filter-icon");
export const LoaderIcon = /*#__PURE__*/ createIcon(LucideLoaderIcon, "loader-icon");
export const LockOpenIcon = /*#__PURE__*/ createIcon(LucideLockOpenIcon, "lock-open-icon");
export const LockIcon = /*#__PURE__*/ createIcon(LucideLockIcon, "lock-icon");
export const LogOutIcon = /*#__PURE__*/ createIcon(LucideLogOutIcon, "log-out-icon");
export const MailOpenIcon = /*#__PURE__*/ createIcon(LucideMailOpenIcon, "mail-open-icon");
export const MailIcon = /*#__PURE__*/ createIcon(LucideMailIcon, "mail-icon");
export const MapPinIcon = /*#__PURE__*/ createIcon(LucideMapPinIcon, "map-pin-icon");
export const MapIcon = /*#__PURE__*/ createIcon(LucideMapIcon, "map-icon");
export const MenuIcon = /*#__PURE__*/ createIcon(LucideMenuIcon, "menu-icon");
export const MessageCircleIcon = /*#__PURE__*/ createIcon(LucideMessageCircleIcon, "message-circle-icon");
export const MessagesSquareIcon = /*#__PURE__*/ createIcon(LucideMessagesSquareIcon, "messages-square-icon");
export const MicOffIcon = /*#__PURE__*/ createIcon(LucideMicOffIcon, "mic-off-icon");
export const MicIcon = /*#__PURE__*/ createIcon(LucideMicIcon, "mic-icon");
export const MonitorIcon = /*#__PURE__*/ createIcon(LucideMonitorIcon, "monitor-icon");
export const MoonIcon = /*#__PURE__*/ createIcon(LucideMoonIcon, "moon-icon");
export const PaintbrushIcon = /*#__PURE__*/ createIcon(LucidePaintbrushIcon, "paintbrush-icon");
export const PaperclipIcon = /*#__PURE__*/ createIcon(LucidePaperclipIcon, "paperclip-icon");
export const PauseIcon = /*#__PURE__*/ createIcon(LucidePauseIcon, "pause-icon");
export const PencilIcon = /*#__PURE__*/ createIcon(LucidePencilIcon, "pencil-icon");
export const PhoneCallIcon = /*#__PURE__*/ createIcon(LucidePhoneCallIcon, "phone-call-icon");
export const PhoneIncomingIcon = /*#__PURE__*/ createIcon(LucidePhoneIncomingIcon, "phone-incoming-icon");
export const PhoneOffIcon = /*#__PURE__*/ createIcon(LucidePhoneOffIcon, "phone-off-icon");
export const PhoneOutgoingIcon = /*#__PURE__*/ createIcon(LucidePhoneOutgoingIcon, "phone-outgoing-icon");
export const PhoneIcon = /*#__PURE__*/ createIcon(LucidePhoneIcon, "phone-icon");
export const PlayIcon = /*#__PURE__*/ createIcon(LucidePlayIcon, "play-icon");
export const PlusIcon = /*#__PURE__*/ createIcon(LucidePlusIcon, "plus-icon");
export const RefreshCcwIcon = /*#__PURE__*/ createIcon(LucideRefreshCcwIcon, "refresh-ccw-icon");
export const RefreshCwIcon = /*#__PURE__*/ createIcon(LucideRefreshCwIcon, "refresh-cw-icon");
export const RepeatIcon = /*#__PURE__*/ createIcon(LucideRepeatIcon, "repeat-icon");
export const RocketIcon = /*#__PURE__*/ createIcon(LucideRocketIcon, "rocket-icon");
export const RotateCcwIcon = /*#__PURE__*/ createIcon(LucideRotateCcwIcon, "rotate-ccw-icon");
export const RotateCwIcon = /*#__PURE__*/ createIcon(LucideRotateCwIcon, "rotate-cw-icon");
export const SearchIcon = /*#__PURE__*/ createIcon(LucideSearchIcon, "search-icon");
export const SendIcon = /*#__PURE__*/ createIcon(LucideSendIcon, "send-icon");
export const SettingsIcon = /*#__PURE__*/ createIcon(LucideSettingsIcon, "settings-icon");
export const Share2Icon = /*#__PURE__*/ createIcon(LucideShare2Icon, "share-2-icon");
export const ShieldCheckIcon = /*#__PURE__*/ createIcon(LucideShieldCheckIcon, "shield-check-icon");
export const ShieldIcon = /*#__PURE__*/ createIcon(LucideShieldIcon, "shield-icon");
export const ShuffleIcon = /*#__PURE__*/ createIcon(LucideShuffleIcon, "shuffle-icon");
export const SlidersHorizontalIcon = /*#__PURE__*/ createIcon(LucideSlidersHorizontalIcon, "sliders-horizontal-icon");
export const SlidersVerticalIcon = /*#__PURE__*/ createIcon(LucideSlidersVerticalIcon, "sliders-vertical-icon");
export const SmartphoneIcon = /*#__PURE__*/ createIcon(LucideSmartphoneIcon, "smartphone-icon");
export const SparklesIcon = /*#__PURE__*/ createIcon(LucideSparklesIcon, "sparkles-icon");
export const SplitIcon = /*#__PURE__*/ createIcon(LucideSplitIcon, "split-icon");
export const SquareCheckIcon = /*#__PURE__*/ createIcon(LucideSquareCheckIcon, "square-check-icon");
export const SquarePenIcon = /*#__PURE__*/ createIcon(LucideSquarePenIcon, "square-pen-icon");
export const StarIcon = /*#__PURE__*/ createIcon(LucideStarIcon, "star-icon");
export const SunIcon = /*#__PURE__*/ createIcon(LucideSunIcon, "sun-icon");
export const SunriseIcon = /*#__PURE__*/ createIcon(LucideSunriseIcon, "sunrise-icon");
export const SunsetIcon = /*#__PURE__*/ createIcon(LucideSunsetIcon, "sunset-icon");
export const TagsIcon = /*#__PURE__*/ createIcon(LucideTagsIcon, "tags-icon");
export const TerminalIcon = /*#__PURE__*/ createIcon(LucideTerminalIcon, "terminal-icon");
export const Trash2Icon = /*#__PURE__*/ createIcon(LucideTrash2Icon, "trash-2-icon");
export const TrashIcon = /*#__PURE__*/ createIcon(LucideTrashIcon, "trash-icon");
export const TriangleAlertIcon = /*#__PURE__*/ createIcon(LucideTriangleAlertIcon, "triangle-alert-icon");
export const UploadIcon = /*#__PURE__*/ createIcon(LucideUploadIcon, "upload-icon");
export const UserCheckIcon = /*#__PURE__*/ createIcon(LucideUserCheckIcon, "user-check-icon");
export const UserPlusIcon = /*#__PURE__*/ createIcon(LucideUserPlusIcon, "user-plus-icon");
export const UserXIcon = /*#__PURE__*/ createIcon(LucideUserXIcon, "user-x-icon");
export const UserIcon = /*#__PURE__*/ createIcon(LucideUserIcon, "user-icon");
export const UsersIcon = /*#__PURE__*/ createIcon(LucideUsersIcon, "users-icon");
export const VenetianMaskIcon = /*#__PURE__*/ createIcon(LucideVenetianMaskIcon, "venetian-mask-icon");
export const VideoIcon = /*#__PURE__*/ createIcon(LucideVideoIcon, "video-icon");
export const WaypointsIcon = /*#__PURE__*/ createIcon(LucideWaypointsIcon, "waypoints-icon");
export const WebhookIcon = /*#__PURE__*/ createIcon(LucideWebhookIcon, "webhook-icon");
export const XIcon = /*#__PURE__*/ createIcon(LucideXIcon, "x-icon");
export const ZapIcon = /*#__PURE__*/ createIcon(LucideZapIcon, "zap-icon");
