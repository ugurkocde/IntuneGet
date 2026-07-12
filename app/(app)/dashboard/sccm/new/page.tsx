'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Upload,
  FileJson,
  FileSpreadsheet,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  Info,
  Download,
  Terminal,
} from 'lucide-react';
import { toast } from 'sonner';
import { T } from 'gt-next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { PageHeader } from '@/components/dashboard';
import { SccmMigrationStepper } from '@/components/sccm';
import type { SccmImportResponse } from '@/types/sccm';

type FileType = 'csv' | 'json';

interface ImportState {
  step: 'upload' | 'importing' | 'complete' | 'error';
  fileName: string | null;
  fileType: FileType | null;
  fileContent: string | null;
  migrationName: string;
  migrationDescription: string;
  result: SccmImportResponse | null;
  error: string | null;
}

export default function NewMigrationPage() {
  const router = useRouter();
  const { getAccessToken } = useMicrosoftAuth();

  const [state, setState] = useState<ImportState>({
    step: 'upload',
    fileName: null,
    fileType: null,
    fileContent: null,
    migrationName: '',
    migrationDescription: '',
    result: null,
    error: null,
  });

  const [isDragging, setIsDragging] = useState(false);

  const getFilePreview = () => {
    if (!state.fileContent) return null;
    if (state.fileType === 'csv') {
      const lines = state.fileContent.split('\n').filter(l => l.trim());
      return { rows: Math.max(0, lines.length - 1), type: 'CSV' };
    }
    try {
      const json = JSON.parse(state.fileContent);
      const apps = json.applications || json;
      return { rows: Array.isArray(apps) ? apps.length : 0, type: 'JSON' };
    } catch {
      return null;
    }
  };

  const handleFileSelect = useCallback(async (file: File) => {
    const fileName = file.name;
    const extension = fileName.split('.').pop()?.toLowerCase();

    let fileType: FileType;
    if (extension === 'csv') {
      fileType = 'csv';
    } else if (extension === 'json') {
      fileType = 'json';
    } else {
      setState(prev => ({
        ...prev,
        error: 'Please upload a CSV or JSON file',
      }));
      return;
    }

    try {
      const content = await file.text();

      // Generate migration name from filename
      const baseName = fileName.replace(/\.(csv|json)$/i, '');
      const migrationName = `SCCM Import - ${baseName}`;

      setState(prev => ({
        ...prev,
        fileName,
        fileType,
        fileContent: content,
        migrationName,
        error: null,
      }));
    } catch {
      setState(prev => ({
        ...prev,
        error: 'Failed to read file',
      }));
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleImport = async () => {
    if (!state.fileContent || !state.fileType || !state.migrationName) {
      return;
    }

    setState(prev => ({ ...prev, step: 'importing', error: null }));

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Authentication required');
      }

      const response = await fetch('/api/sccm/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          migrationName: state.migrationName,
          migrationDescription: state.migrationDescription,
          fileContent: state.fileContent,
          fileType: state.fileType,
          fileName: state.fileName,
        }),
      });

      const data: SccmImportResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.errors?.[0]?.message || 'Failed to import applications');
      }

      toast.success(`Successfully imported ${data.validApps} applications`);

      setState(prev => ({
        ...prev,
        step: 'complete',
        result: data,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      toast.error(message);
      setState(prev => ({
        ...prev,
        step: 'error',
        error: message,
      }));
    }
  };

  const handleDownloadScript = () => {
    const link = document.createElement('a');
    link.href = '/scripts/Export-SCCMApps.ps1';
    link.download = 'Export-SCCMApps.ps1';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filePreview = getFilePreview();

  const renderUploadStep = () => (
    <div className="max-w-2xl mx-auto">
      {/* PowerShell Export Script Section */}
      <div className="mb-8 p-6 bg-gradient-to-br from-accent-violet/10 to-accent-cyan/5 border border-accent-violet/20 rounded-xl">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-accent-violet/20 rounded-lg flex items-center justify-center flex-shrink-0">
            <Terminal className="w-6 h-6 text-accent-violet" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-text-primary mb-1">
              <T>Export from SCCM</T>
            </h3>
            <p className="text-text-secondary text-sm mb-4">
              <T>Run this PowerShell script on your SCCM server to export applications with their deployment types, detection rules, and settings.</T>
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={handleDownloadScript}
                className="bg-accent-violet hover:bg-accent-violet/90"
              >
                <Download className="w-4 h-4 mr-2" />
                <T>Download Script</T>
              </Button>
              <span className="text-text-muted text-sm">Export-SCCMApps.ps1</span>
            </div>
            <div className="mt-4 p-3 bg-overlay/5 rounded-lg border border-overlay/5">
              <p className="text-xs text-text-muted font-mono">
                # Run on SCCM server with ConfigMgr console installed
              </p>
              <p className="text-xs text-accent-cyan font-mono mt-1">
                .\Export-SCCMApps.ps1 -OutputPath &quot;C:\Exports\apps.json&quot;
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-4 mb-8">
        <div className="flex-1 h-px bg-overlay/10" />
        <span className="text-text-muted text-sm"><T>or upload existing export</T></span>
        <div className="flex-1 h-px bg-overlay/10" />
      </div>

      {/* Dropzone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          'relative border-2 border-dashed rounded-xl p-8 text-center transition-all',
          isDragging
            ? 'border-accent-cyan bg-accent-cyan/5'
            : state.fileContent
              ? 'border-status-success/50 bg-status-success/5'
              : 'border-overlay/10 hover:border-black/20 bg-black/2'
        )}
      >
        <input
          type="file"
          accept=".csv,.json"
          onChange={handleFileInput}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />

        <div className="space-y-4">
          {state.fileContent ? (
            <>
              <div className="w-16 h-16 mx-auto bg-status-success/10 rounded-xl flex items-center justify-center">
                {state.fileType === 'csv' ? (
                  <FileSpreadsheet className="w-8 h-8 text-status-success" />
                ) : (
                  <FileJson className="w-8 h-8 text-status-success" />
                )}
              </div>
              <div>
                <p className="text-text-primary font-medium">{state.fileName}</p>
                <p className="text-text-muted text-sm mt-1">
                  <T>{state.fileType?.toUpperCase()} file ready to import</T>
                  {filePreview && (
                    <span className="ml-1 text-accent-cyan">
                      <T>-- {filePreview.rows} application{filePreview.rows !== 1 ? 's' : ''} detected</T>
                    </span>
                  )}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-text-secondary"
                onClick={(e) => {
                  e.preventDefault();
                  setState(prev => ({
                    ...prev,
                    fileName: null,
                    fileType: null,
                    fileContent: null,
                    migrationName: '',
                  }));
                }}
              >
                <T>Change File</T>
              </Button>
            </>
          ) : (
            <>
              <div className="w-16 h-16 mx-auto bg-overlay/5 rounded-xl flex items-center justify-center">
                <Upload className="w-8 h-8 text-text-secondary" />
              </div>
              <div>
                <p className="text-text-primary font-medium"><T>Drop your SCCM export file here</T></p>
                <p className="text-text-muted text-sm mt-1">
                  <T>or click to browse. Supports CSV and JSON formats.</T>
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* File format info - only when no file selected */}
      {!state.fileContent && (
        <div className="mt-6 p-4 bg-accent-cyan/5 border border-accent-cyan/20 rounded-lg">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-accent-cyan flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-accent-cyan font-medium"><T>Expected CSV columns:</T></p>
              <p className="text-text-secondary mt-1">
                <T>CI_ID, LocalizedDisplayName, Manufacturer, SoftwareVersion, IsDeployed, DeploymentCount, InstallCommand, UninstallCommand, InstallBehavior, Technology</T>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Migration details */}
      {state.fileContent && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              <T>Migration Name</T>
            </label>
            <input
              type="text"
              value={state.migrationName}
              onChange={(e) => setState(prev => ({ ...prev, migrationName: e.target.value }))}
              className="w-full px-4 py-2 bg-overlay/5 border border-overlay/10 rounded-lg text-text-primary placeholder-text-muted focus:border-accent-cyan focus:outline-none focus:ring-1 focus:ring-accent-cyan"
              placeholder="Enter migration name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              <T>Description (optional)</T>
            </label>
            <textarea
              value={state.migrationDescription}
              onChange={(e) => setState(prev => ({ ...prev, migrationDescription: e.target.value }))}
              rows={3}
              className="w-full px-4 py-2 bg-overlay/5 border border-overlay/10 rounded-lg text-text-primary placeholder-text-muted focus:border-accent-cyan focus:outline-none focus:ring-1 focus:ring-accent-cyan resize-none"
              placeholder="Describe this migration"
            />
          </div>
        </motion.div>
      )}

      {/* Error */}
      {state.error && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 flex items-start gap-3 p-4 bg-status-error/10 border border-status-error/20 rounded-lg"
        >
          <AlertCircle className="w-5 h-5 text-status-error flex-shrink-0 mt-0.5" />
          <p className="text-status-error text-sm">{state.error}</p>
        </motion.div>
      )}

      {/* Actions */}
      <div className="mt-8 flex items-center justify-between">
        <Button
          variant="outline"
          className="border-overlay/10 text-text-secondary"
          onClick={() => router.push('/dashboard/sccm')}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          <T>Back</T>
        </Button>

        <Button
          className="bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90"
          disabled={!state.fileContent || !state.migrationName}
          onClick={handleImport}
        >
          <T>Import Applications</T>
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );

  const renderImportingStep = () => (
    <div className="max-w-md mx-auto text-center">
      <div className="w-20 h-20 mx-auto bg-accent-cyan/10 rounded-xl flex items-center justify-center mb-6">
        <Loader2 className="w-10 h-10 text-accent-cyan animate-spin" />
      </div>
      <h2 className="text-xl font-semibold text-text-primary mb-2"><T>Importing Applications</T></h2>
      <p className="text-text-secondary">
        <T>Parsing {state.fileName} and creating migration records...</T>
      </p>
    </div>
  );

  const renderCompleteStep = () => (
    <div className="max-w-md mx-auto text-center">
      <div className="w-20 h-20 mx-auto bg-status-success/10 rounded-xl flex items-center justify-center mb-6">
        <CheckCircle2 className="w-10 h-10 text-status-success" />
      </div>
      <h2 className="text-xl font-semibold text-text-primary mb-2"><T>Import Complete!</T></h2>
      <p className="text-text-secondary mb-6">
        <T>Successfully imported {state.result?.validApps} applications.</T>
        {state.result?.skippedApps && state.result.skippedApps > 0 && (
          <span className="block text-status-warning mt-1">
            <T>{state.result.skippedApps} apps were skipped due to errors.</T>
          </span>
        )}
      </p>

      <div className="flex items-center justify-center gap-4">
        <Button
          variant="outline"
          className="border-overlay/10 text-text-secondary"
          onClick={() => router.push('/dashboard/sccm')}
        >
          <T>Back to Migrations</T>
        </Button>
        <Button
          className="bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90"
          onClick={() => router.push(`/dashboard/sccm/${state.result?.migrationId}`)}
        >
          <T>View Migration</T>
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );

  const renderErrorStep = () => (
    <div className="max-w-md mx-auto text-center">
      <div className="w-20 h-20 mx-auto bg-status-error/10 rounded-xl flex items-center justify-center mb-6">
        <AlertCircle className="w-10 h-10 text-status-error" />
      </div>
      <h2 className="text-xl font-semibold text-text-primary mb-2"><T>Import Failed</T></h2>
      <p className="text-status-error mb-6">{state.error}</p>

      <div className="flex items-center justify-center gap-4">
        <Button
          variant="outline"
          className="border-overlay/10 text-text-secondary"
          onClick={() => router.push('/dashboard/sccm')}
        >
          <T>Back to Migrations</T>
        </Button>
        <Button
          className="bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90"
          onClick={() => setState(prev => ({ ...prev, step: 'upload', error: null }))}
        >
          <T>Try Again</T>
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={<T>New Migration</T>}
        description={<T>Import your SCCM application export to begin migration</T>}
        gradient
        gradientColors="cyan"
      />

      <SccmMigrationStepper currentStep={1} />

      <div className="glass-light rounded-xl p-8 border border-overlay/5">
        {state.step === 'upload' && renderUploadStep()}
        {state.step === 'importing' && renderImportingStep()}
        {state.step === 'complete' && renderCompleteStep()}
        {state.step === 'error' && renderErrorStep()}
      </div>
    </div>
  );
}
