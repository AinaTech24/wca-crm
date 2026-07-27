// Icon set — clean, consistent line icons (lucide, the open-source set behind
// most IconsBuddy line packs) used across the sidebar, topbar and dashboard.
// The `Ic` component keeps the exact same API as before (name/size/stroke/style)
// so every call site in the app is unchanged.
import {
  Home, LayoutGrid, User, Users, SlidersHorizontal, Star, Puzzle, FileText, Mail,
  Car, Tag, TriangleAlert, Building2, Landmark, Box, Upload, File, IndianRupee,
  Pencil, RefreshCw, Target, ChartBar, Calendar, CheckSquare, Clock, Lock, Gift,
  Circle, Bell, CircleHelp, Search, Menu, ChevronDown, Eye, EyeOff, Cloud, Phone,
  UserPlus, Send, ShieldCheck, Truck, ClipboardList, Trash2, Plus, X, ListFilter,
  Download, Check, MoreHorizontal, ArrowUp, ExternalLink, Pin, PinOff, PanelLeftClose, PanelLeft,
  ArrowRight, ArrowLeft, ChevronLeft, ChevronRight, LogOut, Filter, FileDown,
} from 'lucide-react';

const ICONS = {
  home: Home, grid: LayoutGrid, user: User, users: Users, sliders: SlidersHorizontal,
  star: Star, puzzle: Puzzle, doc: FileText, mail: Mail, car: Car, tag: Tag,
  alert: TriangleAlert, building: Building2, bank: Landmark, box: Box, upload: Upload,
  file: File, dollar: IndianRupee, rupee: IndianRupee, edit: Pencil, refresh: RefreshCw, target: Target,
  chart: ChartBar, calendar: Calendar, checksquare: CheckSquare, clock: Clock,
  lock: Lock, gift: Gift, dot: Circle, bell: Bell, help: CircleHelp, search: Search,
  menu: Menu, chevron: ChevronDown, eye: Eye, eyeoff: EyeOff, cloud: Cloud,
  phone: Phone, userplus: UserPlus, send: Send, shieldcheck: ShieldCheck,
  dispatch: Truck, clipboard: ClipboardList, trash: Trash2, plus: Plus, x: X,
  filter: ListFilter, download: Download, check: Check, more: MoreHorizontal,
  arrowup: ArrowUp, externallink: ExternalLink, pin: Pin, pinoff: PinOff,
  'panel-close': PanelLeftClose, 'panel-open': PanelLeft,
  arrowright: ArrowRight, arrowleft: ArrowLeft, 'chevron-left': ChevronLeft, 'chevron-right': ChevronRight,
  logout: LogOut, funnel: Filter, 'file-export': FileDown,
};

export function Ic({ name, size = 18, stroke = 2, style }) {
  const Cmp = ICONS[name] || Circle;
  return <Cmp size={size} strokeWidth={stroke} style={style} aria-hidden="true" />;
}

export function iconFor(label) {
  const l = label.toLowerCase();
  if (/profile/.test(l)) return 'user';
  if (/password/.test(l)) return 'lock';
  if (/birthday|anniversary/.test(l)) return 'gift';
  if (/client|agency|\bba\b|merging/.test(l)) return 'user';
  if (/dashboard|preference/.test(l)) return 'sliders';
  if (/favourite/.test(l)) return 'star';
  if (/add on/.test(l)) return 'puzzle';
  if (/content/.test(l)) return 'doc';
  if (/claim|mail|intimation|template|welcome|sms|wa /.test(l)) return 'mail';
  if (/\bmake\b/.test(l)) return 'car';
  if (/\bmodel\b/.test(l)) return 'tag';
  if (/risk/.test(l)) return 'alert';
  if (/occupancy/.test(l)) return 'building';
  if (/hpa|bank/.test(l)) return 'bank';
  if (/product/.test(l)) return 'box';
  if (/excel|upload/.test(l)) return 'upload';
  if (/commission|payin|payout|cash|credit|debit/.test(l)) return 'dollar';
  if (/endorsement/.test(l)) return 'edit';
  if (/renewal|renew|cross sell|up sell|fup/.test(l)) return 'refresh';
  if (/lead/.test(l)) return 'target';
  if (/calendar|event|premium|due/.test(l)) return 'calendar';
  if (/task/.test(l)) return 'checksquare';
  if (/scheduler|reminder/.test(l)) return 'clock';
  if (/report|wise|portfolio|summary|register|status|maturity|surrender|paid|record|minor|death|top|history|vehicle|lapse|pending|decline|new|business|transaction/.test(l)) return 'chart';
  if (/policy|proposal|fd |scheme|slider|youtube|app/.test(l)) return 'file';
  return 'dot';
}
