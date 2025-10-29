import { Injectable } from '@angular/core';
import { GoogleGenAI, Type } from '@google/genai';

export interface FileForProcessing {
  name: string;
  type: string;
  dataUrl: string;
  base64Data: string;
}

export interface AnalysisResult {
  folder: string;
  tags: string[];
  summary: string;
  suggestedFilename: string;
}

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private genAI: GoogleGenAI;

  constructor() {
    // This is a placeholder for the API key.
    // In a real Applet environment, process.env.API_KEY is populated.
    const apiKey = (window as any).process?.env?.API_KEY ?? 'YOUR_API_KEY_PLACEHOLDER';
    if (apiKey === 'YOUR_API_KEY_PLACEHOLDER') {
        console.warn('Using a placeholder API key for Gemini. Please ensure the environment variable is set.');
    }
    this.genAI = new GoogleGenAI({ apiKey });
  }

  async analyzeFile(
    file: FileForProcessing,
    folders: string[]
  ): Promise<AnalysisResult> {
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
        throw new Error('Only image and PDF files can be processed.');
    }

    try {
      const prompt = `You are an expert file organizer. Your task is to analyze the provided file and provide categorization details.
The available folders are: ${folders.join(', ')}.
The original filename is "${file.name}".

1. Analyze the content of the file.
2. Choose the single most appropriate folder from the provided list. This is the top priority.
3. **IMPORTANT**: If, and only if, the file content is clearly distinct and does not fit well into ANY of the existing folders, you may suggest a new, single-word or two-word folder name that would be a perfect fit. The suggested folder name MUST be filesystem-friendly and MUST NOT contain any illegal characters for Windows filenames (e.g., < > : " / \\ | ? *).
4. Generate a list of 3-5 relevant tags that describe the file's content.
5. For documents (like PDFs), create a concise 2-3 sentence summary. For images, create a short descriptive caption.
6. Suggest a new, filesystem-friendly filename. It should be descriptive, in kebab-case (e.g., 'my-new-file'), and MUST preserve the original file extension. It MUST NOT contain any illegal characters for Windows filenames (e.g., < > : " / \\ | ? *).

Respond with a JSON object.`;
      
      const filePart = {
        inlineData: {
          mimeType: file.type,
          data: file.base64Data,
        },
      };

      const textPart = { text: prompt };

      const response = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [filePart, textPart] },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    folder: {
                        type: Type.STRING,
                        description: `The suggested folder. This must be filesystem-friendly and not contain illegal characters (< > : " / \\ | ? *). This should be one of [${folders.join(', ')}]. In rare cases where no existing folder is a good fit, this can be a new folder name.`
                    },
                    tags: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: 'A list of 3-5 relevant tags.'
                    },
                    summary: {
                        type: Type.STRING,
                        description: 'A summary for documents or a caption for images.'
                    },
                    suggestedFilename: {
                        type: Type.STRING,
                        description: `A descriptive, kebab-case filename that preserves the original extension from "${file.name}". It MUST NOT contain any illegal characters for Windows filenames (< > : " / \\ | ? *).`
                    }
                },
                required: ['folder', 'tags', 'summary', 'suggestedFilename']
            }
        }
      });

      const resultJson = response.text.trim();
      const result: AnalysisResult = JSON.parse(resultJson);
      
      return result;

    } catch (error) {
      console.error('Error calling Gemini API:', error);
      throw new Error('Failed to get analysis from Gemini.');
    }
  }
}