'use client';

import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { ReportTable } from '@/types/pilotage';

/**
 * Tableaux de rapport paginés côté client (les lignes complètes sont
 * déjà calculées et filtrées côté serveur, pagination d'affichage).
 */

function ReportDataTable({ reportTable }: { reportTable: ReportTable }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const from = page * rowsPerPage;
  const shown = reportTable.rows.slice(from, from + rowsPerPage);
  return (
    <Paper variant="outlined">
      <Typography variant="subtitle1" sx={{ px: 2, pt: 2 }}>
        {reportTable.label}
      </Typography>
      {reportTable.note ? (
        <Typography variant="caption" color="text.secondary" sx={{ px: 2 }}>
          {reportTable.note}
        </Typography>
      ) : null}
      {reportTable.rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 2 }}>
          Aucune donnée pour la période et les filtres appliqués.
        </Typography>
      ) : (
        <>
          <TableContainer>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {reportTable.columns.map((column) => (
                    <TableCell key={column.key} align={column.numeric ? 'right' : 'left'}>
                      {column.label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {shown.map((row, index) => (
                  <TableRow key={index}>
                    {reportTable.columns.map((column) => (
                      <TableCell
                        key={column.key}
                        align={column.numeric ? 'right' : 'left'}
                      >
                        {typeof row[column.key] === 'number'
                          ? (row[column.key] as number).toLocaleString('fr-FR')
                          : (row[column.key] ?? '')}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={reportTable.rows.length}
            page={page}
            onPageChange={(_event, value) => setPage(value)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(event) => {
              setRowsPerPage(Number(event.target.value));
              setPage(0);
            }}
            rowsPerPageOptions={[10, 25, 50]}
            labelRowsPerPage="Lignes par page"
          />
        </>
      )}
    </Paper>
  );
}

export default function ReportTables({ tables }: { tables: ReportTable[] }) {
  if (tables.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Cette section ne comporte pas de tableau détaillé ; consultez les
        sections métier pour les ventilations.
      </Typography>
    );
  }
  return (
    <Stack spacing={2}>
      {tables.map((reportTable) => (
        <ReportDataTable key={reportTable.key} reportTable={reportTable} />
      ))}
    </Stack>
  );
}
