'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import AlertsView from './alerts-view';
import FilterBar from './filter-bar';
import KpiCards from './kpi-cards';
import ReportTables from './report-tables';
import { usePilotageAlerts, usePilotageReport, usePilotageState } from './use-pilotage';

/**
 * Page client « Rapports & pilotage » (admin) : sections de rapport,
 * filtres de période, alertes transversales et exports Excel/PDF
 * produits par les mêmes services de calcul que l'affichage.
 */

const SECTIONS: Array<[string, string]> = [
  ['general', 'Vue générale'],
  ['coupe', 'Coupe'],
  ['couture', 'Couture'],
  ['qualite', 'Qualité'],
  ['retouche', 'Retouche'],
  ['stock', 'Stock'],
  ['sorties', 'Commandes & sorties'],
];

function TabPanel({ shown, children }: { shown: boolean; children: React.ReactNode }) {
  if (!shown) return null;
  return <Box sx={{ pt: 2 }}>{children}</Box>;
}

export default function PilotageClient() {
  const state = usePilotageState();
  const [tab, setTab] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  const report = usePilotageReport(state.reportQuery);
  const alerts = usePilotageAlerts(state.alertsQuery);

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" className="p-4">
        <Typography variant="h5" component="h2" gutterBottom>
          Rapports &amp; pilotage
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Tous les chiffres proviennent des données réelles de la base. Chaque
          indicateur précise sa source ; les périodes vides affichent la valeur
          absolue sans pourcentage trompeur.
        </Typography>
      </Paper>

      <Tabs value={tab} onChange={(_event, value) => setTab(value)}>
        <Tab label="Rapports" />
        <Tab label="Alertes transversales" />
      </Tabs>

      <TabPanel shown={tab === 0}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
            <Box sx={{ minWidth: 240 }}>
              <Select
                value={state.section}
                onChange={(event) => state.setSection(event.target.value)}
                size="small"
                fullWidth
              >
                {SECTIONS.map(([key, label]) => (
                  <MenuItem key={key} value={key}>
                    {label}
                  </MenuItem>
                ))}
              </Select>
            </Box>
            <Button
              size="small"
              variant="outlined"
              onClick={() => window.open(state.exportUrl('excel'), '_blank')}
            >
              Export Excel
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={() => window.open(state.exportUrl('pdf'), '_blank')}
            >
              Export PDF
            </Button>
          </Stack>
          <FilterBar
            period={state.period}
            onPeriodChange={state.setPeriod}
            from={state.from}
            to={state.to}
            onFromChange={state.setFrom}
            onToChange={state.setTo}
            filters={state.filters}
            onFilterChange={state.setFilter}
            onReset={state.resetFilters}
            advanced={advanced}
            onToggleAdvanced={() => setAdvanced((value) => !value)}
          />
          {report.error ? <Alert severity="error">{report.error}</Alert> : null}
          {report.loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={28} />
            </Box>
          ) : null}
          {report.report ? (
            <>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Chip label={report.report.title} color="primary" size="small" />
                <Chip label={`Période : ${report.report.periodLabel}`} size="small" variant="outlined" />
                <Chip
                  label={`Comparaison : ${report.report.previousLabel}`}
                  size="small"
                  variant="outlined"
                />
              </Stack>
              <KpiCards kpis={report.report.kpis} />
              <ReportTables tables={report.report.tables} />
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Définitions et notes
                </Typography>
                {report.report.notes.map((note) => (
                  <Typography key={note} variant="caption" display="block" color="text.secondary">
                    • {note}
                  </Typography>
                ))}
              </Paper>
            </>
          ) : null}
        </Stack>
      </TabPanel>

      <TabPanel shown={tab === 1}>
        <AlertsView
          alerts={alerts.alerts}
          loading={alerts.loading}
          error={alerts.error}
          severity={state.alertsSeverity}
          onSeverityChange={state.setAlertsSeverity}
          status={state.alertsStatus}
          onStatusChange={state.setAlertsStatus}
          onRefresh={alerts.refresh}
        />
      </TabPanel>
    </Stack>
  );
}
