import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { GeminiService } from './services/gemini.service';
import { PdfViewerComponent } from './pdf-viewer.component';
import { DocxViewerComponent } from './docx-viewer.component';

type FileStatus = 'pending' | 'processing' | 'done' | 'error';

interface AppFile {
  id: string; // Unique ID for tracking
  originalFile: File;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  safeUrl: SafeResourceUrl;
  base64Data: string;
  originalPath: string; // e.g., "ToSort/invoice-scan.pdf"
  extractedText?: string;
  blob?: Blob; // For docx-preview
  status: FileStatus;
  suggestion?: string; // Original AI suggestion
  finalFolder?: string; // User-controlled final choice
  tags?: string[];
  summary?: string;
  suggestedName?: string;
  useNewName: boolean;
  errorMessage?: string;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, PdfViewerComponent, DocxViewerComponent],
})
export class AppComponent {
  private geminiService = inject(GeminiService);
  private sanitizer: DomSanitizer = inject(DomSanitizer);

  folders = signal('Invoices, Receipts, Personal Photos, Work Documents, Travel');
  files = signal<AppFile[]>([]);
  isProcessing = signal(false);
  isDragging = signal(false);
  fileInModal = signal<AppFile | null>(null);

  sourceFolderName = signal<string | null>(null);
  destinationFolderName = signal<string | null>(null);
  manualSourcePath = signal('');
  manualDestinationPath = signal('');

  processedCount = signal(0);
  totalToProcess = signal(0);
  progressPercentage = computed(() => {
    const total = this.totalToProcess();
    if (total === 0) return 0;
    return (this.processedCount() / total) * 100;
  });

  foldersForSelect = computed(() => {
    const folderList = this.folders().split(',').map(f => this.sanitizeFolderPath(f)).filter(f => f);
    const uniqueFolders: string[] = Array.from(new Set(folderList));
    if (!uniqueFolders.find(f => f.toLowerCase() === 'miscellaneous')) {
        uniqueFolders.push('Miscellaneous');
    }
    return uniqueFolders.sort();
  });

  onFoldersInput(event: Event): void {
    this.folders.set((event.target as HTMLTextAreaElement).value);
    // Manually editing folders voids the scanned destination folder name
    this.destinationFolderName.set(null);
    this.manualDestinationPath.set('');
  }

  handleFileSelect(event: Event): void {
    const element = event.target as HTMLInputElement;
    const selectedFiles = element.files;
    if (selectedFiles) {
      // Selecting individual files voids the source folder name
      this.sourceFolderName.set(null);
      this.manualSourcePath.set('');
      this.files.set([]); // Clear existing files for a clean slate
      this.processFiles(Array.from(selectedFiles));
    }
    if (element) element.value = '';
  }

  handleSourceFolderSelect(event: Event): void {
    const element = event.target as HTMLInputElement;
    const selectedFiles = element.files;
    if (!selectedFiles || selectedFiles.length === 0) return;
    
    const allFiles = Array.from(selectedFiles);

    // Extract source folder name from the first file's path
    const firstFileRelativePath = (allFiles[0] as any).webkitRelativePath;
    if (firstFileRelativePath) {
      const pathParts = firstFileRelativePath.split('/');
      if (pathParts.length > 1) {
        const folderName = pathParts[0];
        this.sourceFolderName.set(folderName);
        this.manualSourcePath.set(folderName);
      }
    }

    // Filter for top-level files of supported types
    const filesToProcess = allFiles.filter(file => {
      const relativePath = (file as any).webkitRelativePath;
      if (!relativePath) return false;
      
      const parts = relativePath.split('/');
      // Top-level files are in the directory selected, so the path is "FolderName/file.ext"
      const isTopLevel = parts.length === 2;
      
      return isTopLevel && this.isSupportedFileType(file.type);
    });

    // When selecting a new source, clear old files
    this.files.set([]);
    this.processFiles(filesToProcess);
    if (element) element.value = '';
  }

  handleCategoryFolderSelect(event: Event): void {
    const element = event.target as HTMLInputElement;
    const selectedFiles = element.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    const allFiles = Array.from(selectedFiles);

    // Extract destination folder name from the first file's path
    const firstFileRelativePath = (allFiles[0] as any).webkitRelativePath;
    if (firstFileRelativePath) {
      const pathParts = firstFileRelativePath.split('/');
      if (pathParts.length > 1) {
        const folderName = pathParts[0];
        this.destinationFolderName.set(folderName);
        this.manualDestinationPath.set(folderName);
      }
    }

    const folderNames = new Set<string>();
    
    for (const file of allFiles) {
      const relativePath = (file as any).webkitRelativePath;
      if (!relativePath) continue;

      const pathParts = relativePath.split('/');
      pathParts.shift(); // Remove the root folder name (captured above)
      pathParts.pop(); // Remove the file name
      
      if (pathParts.length > 0) {
        let currentPath = '';
        // Add all parent paths as well
        for (const part of pathParts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            folderNames.add(currentPath);
        }
      }
    }

    if (folderNames.size > 0) {
      // Overwrite existing folders with the scanned structure
      this.folders.set([...new Set(Array.from(folderNames))].join(', '));
    } else {
      // If no subfolders were found, clear it to avoid confusion.
      this.folders.set('');
    }
    
    if (element) element.value = '';
  }

  handleFileDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
    const droppedFiles = event.dataTransfer?.files;
    if (droppedFiles) {
        // Drag-and-drop is for individual files, so clear folder names
        this.sourceFolderName.set(null);
        this.manualSourcePath.set('');
        this.files.set([]);
        this.processFiles(Array.from(droppedFiles));
    }
  }

  handleDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  handleDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  private isSupportedFileType(type: string): boolean {
    const supportedDocTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    ];
    return type.startsWith('image/') || supportedDocTypes.includes(type);
  }

  private processFiles(selectedFiles: File[]): void {
    const filesToProcess = Array.from(selectedFiles);
    const filesForSignal: AppFile[] = [];
    let processedCount = 0;

    const checkAndUpdateSignal = () => {
      processedCount++;
      if (processedCount === filesToProcess.length) {
        this.files.update(current => [...current, ...filesForSignal]);
      }
    };

    if (filesToProcess.length === 0) return;

    for (const file of filesToProcess) {
      const id = `${file.name}-${file.size}-${Date.now()}`;
      const originalPath = (file as any).webkitRelativePath || file.name;

      if (!this.isSupportedFileType(file.type)) {
        filesForSignal.push({
            id,
            originalFile: file,
            name: file.name,
            type: file.type,
            size: file.size,
            dataUrl: '',
            safeUrl: this.sanitizer.bypassSecurityTrustResourceUrl(''),
            base64Data: '',
            originalPath,
            status: 'error',
            useNewName: false,
            errorMessage: 'Only image, PDF & .docx files can be analyzed.'
        });
        checkAndUpdateSignal();
        continue;
      }

      if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          const reader = new FileReader();
          reader.onload = async (e: any) => {
              const arrayBuffer = e.target.result;
              try {
                  const textResult = await (window as any).mammoth.extractRawText({ arrayBuffer });

                  filesForSignal.push({
                      id,
                      originalFile: file,
                      name: file.name,
                      type: file.type,
                      size: file.size,
                      dataUrl: '',
                      safeUrl: this.sanitizer.bypassSecurityTrustResourceUrl(''),
                      base64Data: '',
                      originalPath,
                      extractedText: textResult.value,
                      blob: file,
                      status: 'pending',
                      useNewName: true,
                  });
              } catch (error) {
                  filesForSignal.push({
                      id,
                      originalFile: file,
                      name: file.name,
                      type: file.type,
                      size: file.size,
                      dataUrl: '',
                      safeUrl: this.sanitizer.bypassSecurityTrustResourceUrl(''),
                      base64Data: '',
                      originalPath,
                      status: 'error',
                      useNewName: false,
                      errorMessage: 'Could not read content from .docx file.',
                  });
              } finally {
                  checkAndUpdateSignal();
              }
          };
          reader.readAsArrayBuffer(file);
      } else {
          const reader = new FileReader();
          reader.onload = (e: any) => {
              const dataUrl = e.target.result;
              const base64Data = dataUrl.split(',')[1];
              filesForSignal.push({
                  id,
                  originalFile: file,
                  name: file.name,
                  type: file.type,
                  size: file.size,
                  dataUrl,
                  safeUrl: this.sanitizer.bypassSecurityTrustResourceUrl(dataUrl),
                  base64Data,
                  originalPath,
                  status: 'pending',
                  useNewName: true,
              });
              checkAndUpdateSignal();
          };
          reader.readAsDataURL(file);
      }
    }
  }

  removeFile(fileId: string): void {
    this.files.update(currentFiles => currentFiles.filter(f => f.id !== fileId));
  }

  clearAll(): void {
    this.files.set([]);
    this.sourceFolderName.set(null);
    this.destinationFolderName.set(null);
    this.manualSourcePath.set('');
    this.manualDestinationPath.set('');
  }

  async organizeFiles(): Promise<void> {
    if (this.isProcessing()) return;

    const filesToProcess = this.files().filter(f => f.status === 'pending');
    if (filesToProcess.length === 0) return;

    this.isProcessing.set(true);
    this.totalToProcess.set(filesToProcess.length);
    this.processedCount.set(0);

    const folderList = this.foldersForSelect();
    if (folderList.length === 0) {
        alert('Please define at least one folder category.');
        this.isProcessing.set(false);
        return;
    }

    const CONCURRENCY_LIMIT = 5;
    
    this.files.update(current =>
        current.map(f => (f.status === 'pending' ? { ...f, status: 'processing' } : f))
    );
    
    for (let i = 0; i < filesToProcess.length; i += CONCURRENCY_LIMIT) {
        const batch = filesToProcess.slice(i, i + CONCURRENCY_LIMIT);
        
        await Promise.all(batch.map(async (file) => {
            try {
                const result = await this.geminiService.analyzeFile(file, folderList);
                
                const suggestedFolder = this.sanitizeFolderPath(result.folder);
                const suggestedFilename = this.sanitizeFilename(result.suggestedFilename);

                const existingFolders = this.foldersForSelect();
                const match = existingFolders.find(f => f.toLowerCase() === suggestedFolder.toLowerCase());
                
                let finalFolder: string;
                if (match) {
                    finalFolder = match;
                } else {
                    finalFolder = suggestedFolder;
                    this.folders.update(currentFolders => {
                        const currentList = currentFolders.split(',').map(f => this.sanitizeFolderPath(f)).filter(f => f);
                        if (!currentList.find(f => f.toLowerCase() === finalFolder.toLowerCase())) {
                            return [...currentList, finalFolder].join(', ');
                        }
                        return currentFolders;
                    });
                }

                this.files.update(current =>
                    current.map(f =>
                        f.id === file.id
                        ? { 
                            ...f, 
                            status: 'done', 
                            suggestion: suggestedFolder, 
                            finalFolder: finalFolder,
                            tags: result.tags, 
                            summary: result.summary, 
                            suggestedName: suggestedFilename 
                            }
                        : f
                    )
                );
            } catch (error) {
                this.files.update(current =>
                    current.map(f =>
                        f.id === file.id
                        ? { ...f, status: 'error', errorMessage: 'AI analysis failed.' }
                        : f
                    )
                );
            } finally {
                this.processedCount.update(c => c + 1);
            }
        }));
    }

    this.isProcessing.set(false);
  }

  get canOrganize(): boolean {
      return !this.isProcessing() && this.files().some(f => f.status === 'pending');
  }

  toggleUseNewName(fileId: string): void {
    this.files.update(currentFiles =>
        currentFiles.map(f =>
            f.id === fileId ? { ...f, useNewName: !f.useNewName } : f
        )
    );
  }

  updateFinalFolder(fileId: string, event: Event): void {
    const newFolder = (event.target as HTMLSelectElement).value;
    this.files.update(currentFiles =>
        currentFiles.map(f =>
            f.id === fileId ? { ...f, finalFolder: newFolder } : f
        )
    );
  }

  updateSuggestedName(fileId: string, event: Event): void {
    const newName = (event.target as HTMLInputElement).value;
    this.files.update(currentFiles =>
      currentFiles.map(f =>
        f.id === fileId ? { ...f, suggestedName: this.sanitizeFilename(newName) } : f
      )
    );
  }
  
  openModal(file: AppFile): void {
    if (file.status === 'error') return;
    this.fileInModal.set(file);
  }

  closeModal(): void {
    this.fileInModal.set(null);
  }

  showDownloadSection = computed(() => {
    return this.files().some(f => f.status === 'done' || f.status === 'error');
  });

  onManualSourcePathInput(event: Event): void {
    this.manualSourcePath.set((event.target as HTMLInputElement).value);
  }
  onManualDestinationPathInput(event: Event): void {
    this.manualDestinationPath.set((event.target as HTMLInputElement).value);
  }

  canDownloadScript = computed(() => {
    const hasAnalyzedFiles = this.files().some(f => f.status === 'done');
    // A basic check for what might be an absolute path for Windows (C:\) or Linux/Mac (/)
    const sourcePathValid = this.manualSourcePath().includes(':') || this.manualSourcePath().startsWith('/');
    const destPathValid = this.manualDestinationPath().includes(':') || this.manualDestinationPath().startsWith('/');
    return hasAnalyzedFiles && sourcePathValid && destPathValid;
  });

  private sanitizeFolderPath(path: string): string {
    if (!path) return '';
    return path.trim().replace(/[<>:"|?*]/g, '').replace(/[/\\]+/g, '/');
  }
  
  private sanitizeFilename(name: string): string {
    if (!name) return '';
    // Disallow path separators in filenames
    return name.trim().replace(/[<>:"/\\|?*]/g, '');
  }

  generateAndDownloadScript(): void {
    const analyzedFiles = this.files().filter(f => f.status === 'done');
    const sourcePath = this.manualSourcePath().trim();
    const destinationPath = this.manualDestinationPath().trim();
    
    if (analyzedFiles.length === 0 || !sourcePath || !destinationPath) return;

    let scriptContent = `# AI File Organizer - PowerShell Script
# -------------------------------------
# INSTRUCTIONS:
# 1. This script uses the absolute paths you provided. You can run it from anywhere.
# 2. To run, right-click this file and select "Run with PowerShell".
#
# NOTE: If you get an error about scripts being disabled, run this command in PowerShell once:
# Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
# (And press 'Y' and Enter to confirm)
# -------------------------------------\n
`;
    
    const foldersToCreate = [...new Set(
        analyzedFiles
            .map(f => f.finalFolder)
            .filter(folder => folder && folder !== '--do-not-move--')
    )] as string[];

    if (foldersToCreate.length > 0) {
        scriptContent += `# Create destination subfolders if they don't exist\n`;
        foldersToCreate.forEach(folder => {
            const folderForScript = folder.replace(/\//g, '\\').replace(/'/g, "''");
            const fullDestFolderPath = `${destinationPath.replace(/'/g, "''")}\\${folderForScript}`;
            scriptContent += `$_folderPath = '${fullDestFolderPath}'
if (-not (Test-Path -Path $_folderPath)) {
    Write-Host "Creating folder: $_folderPath"
    New-Item -ItemType Directory -Path $_folderPath -Force | Out-Null
}\n`;
        });
        scriptContent += `\n`;
    }

    scriptContent += `# Process files\n`;
    analyzedFiles.forEach(file => {
        // originalPath is like "SourceFolderName/image.jpg", we just need the "image.jpg" part
        const pathParts = file.originalPath.split(/[/\\]+/);
        const originalFileNameOnly = pathParts.pop()?.replace(/'/g, "''") || file.name.replace(/'/g, "''");
        
        const sourceFilePath = `${sourcePath.replace(/'/g, "''")}\\${originalFileNameOnly}`;
        
        const suggestedNameRaw = file.suggestedName || '';
        const suggestedName = this.sanitizeFilename(suggestedNameRaw).replace(/'/g, "''");
        
        const newName = file.useNewName && suggestedName ? suggestedName : originalFileNameOnly;
        const destinationFolder = file.finalFolder;

        if (destinationFolder && destinationFolder !== '--do-not-move--') {
            const destFolderForScript = destinationFolder.replace(/\//g, '\\').replace(/'/g, "''");
            const destinationFilePath = `${destinationPath.replace(/'/g, "''")}\\${destFolderForScript}\\${newName}`;
            
            scriptContent += `$_sourceFile = '${sourceFilePath}'
$_destFile = '${destinationFilePath}'
if (Test-Path -Path $_sourceFile) {
    Write-Host "Moving '${originalFileNameOnly}' to '${destFolderForScript}\\${newName}'"
    Move-Item -Path $_sourceFile -Destination $_destFile -Force
} else {
    Write-Host "WARNING: Source file not found, skipping: '${originalFileNameOnly}'" -ForegroundColor Yellow
}\n`;
        } else if (file.useNewName && newName !== originalFileNameOnly) {
            const sourceFilePathForRename = `${sourcePath.replace(/'/g, "''")}\\${originalFileNameOnly}`;
            scriptContent += `$_sourceFile = '${sourceFilePathForRename}'
$_newName = '${newName}'
if (Test-Path -Path $_sourceFile) {
    Write-Host "Renaming '${originalFileNameOnly}' to '$_newName' in the source folder"
    Rename-Item -Path $_sourceFile -NewName $_newName
} else {
    Write-Host "WARNING: Source file not found, skipping rename for: '${originalFileNameOnly}'" -ForegroundColor Yellow
}\n`;
        }
    });
    scriptContent += `\n`;
    
    scriptContent += `Write-Host "Organization complete." -ForegroundColor Green\n`;
    scriptContent += `Read-Host "Press Enter to exit..."\n`;

    const utf8BOM = "\uFEFF";
    const blob = new Blob([utf8BOM + scriptContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'organize-files.ps1';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}