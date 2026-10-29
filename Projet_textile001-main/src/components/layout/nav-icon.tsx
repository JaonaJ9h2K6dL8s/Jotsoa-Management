'use client';

import {
  AdminPanelSettingsOutlined,
  CheckroomOutlined,
  ContentCutOutlined,
  DashboardOutlined,
  FactCheckOutlined,
  Inventory2Outlined,
  LocalShippingOutlined,
  PaletteOutlined,
  PrecisionManufacturingOutlined,
  ReportOutlined,
  SecurityOutlined,
  BuildOutlined,
  SettingsOutlined,
  SpeedOutlined,
  StraightenOutlined,
  CropFreeOutlined,
  QrCode2Outlined,
  ScaleOutlined,
  type SvgIconComponent,
} from '@mui/icons-material';
import type { NavIconKey } from '@/lib/permissions';

const ICONS: Record<NavIconKey, SvgIconComponent> = {
  dashboard: DashboardOutlined,
  users: AdminPanelSettingsOutlined,
  settings: SettingsOutlined,
  produits: CheckroomOutlined,
  couleurs: PaletteOutlined,
  tailles: StraightenOutlined,
  zones: CropFreeOutlined,
  defauts: ReportOutlined,
  coupe: ContentCutOutlined,
  couture: PrecisionManufacturingOutlined,
  cadences: SpeedOutlined,
  qualite: FactCheckOutlined,
  retouche: BuildOutlined,
  stock: Inventory2Outlined,
  magasinier: LocalShippingOutlined,
  securite: SecurityOutlined,
  codes: QrCode2Outlined,
  mesures: ScaleOutlined,
};

export default function NavIcon({
  iconKey,
  fontSize = 'small',
}: {
  iconKey: NavIconKey;
  fontSize?: 'small' | 'medium';
}) {
  const Icon = ICONS[iconKey];
  return <Icon fontSize={fontSize} />;
}
