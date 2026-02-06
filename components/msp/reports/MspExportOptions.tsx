'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';

interface MspExportOptionsProps {
  startDate: string;
  endDate: string;
  tenantId?: string;
}

export function MspExportOptions({ startDate, endDate, tenantId }: MspExportOptionsProps) {
  const { getAccessToken } = useMicrosoftAuth();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (isExporting) return;

    const accessToken = await getAccessToken();
    if (!accessToken) return;

    setIsExporting(true);

    try {
      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
        format: 'csv',
      });

      if (tenantId) {
        params.set('tenant_id', tenantId);
      }

      const response = await fetch(`/api/msp/reports/export?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      // Get the filename from Content-Disposition header
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch?.[1] || `msp-report-${startDate}-to-${endDate}.csv`;

      // Create a blob from the response
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      // Create a temporary link and trigger download
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up the URL
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export error:', error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      onClick={handleExport}
      disabled={isExporting}
      variant="outline"
      size="sm"
      className="border-black/20 text-text-primary hover:bg-black/5"
    >
      {isExporting ? (
        <>
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Exporting...
        </>
      ) : (
        <>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </>
      )}
    </Button>
  );
}
