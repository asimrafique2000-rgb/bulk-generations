import React, { useState, useCallback, useMemo, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import JSZip from 'jszip';

// --- Type Definitions ---
interface Scene {
  id: number;
  prompt: string;
  image: string | null;
  isLoading: boolean;
  error: string | null;
}

interface PromptEntry {
  id:string;
  text: string;
  timestamp: string;
}

interface Session {
  id: string;
  timestamp: string;
  script: string;
  scenes: Scene[];
}

type View = 'dashboard' | 'generate' | 'history' | 'assets';

interface GlobalMessage {
    text: string;
    type: 'error' | 'info' | 'success';
}

// --- LocalStorage Hook ---
const usePersistentState = <T,>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] => {
    const [state, setState] = useState<T>(() => {
        try {
            const storedValue = localStorage.getItem(key);
            return storedValue ? JSON.parse(storedValue) : defaultValue;
        } catch (error) {
            console.error(`Error reading localStorage key “${key}”:`, error);
            return defaultValue;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem(key, JSON.stringify(state));
        } catch (error) {
            console.error(`Error setting localStorage key “${key}”:`, error);
        }
    }, [key, state]);

    return [state, setState];
};

// --- Helper Functions ---
const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string, mimeType: string } }> => {
  const base64EncodedDataPromise = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });
  const data = await base64EncodedDataPromise;
  return { inlineData: { data, mimeType: file.type } };
};

// --- Icon Components ---
const Icon = ({ path, className = '' }: {path: string, className?: string}) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>;
const LogoIcon = () => <Icon path="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />;
const DashboardIcon = () => <Icon path="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />;
const HistoryIcon = () => <Icon path="M1 4v6h6" />;
const GenerateIcon = () => <Icon path="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />;
const AssetsIcon = () => <Icon path="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5" />;
const KeyIcon = () => <Icon path="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm-1.414 1.414a3.5 3.5 0 1 0-4.95 4.95 3.5 3.5 0 0 0 4.95-4.95z" />;
const ChevronIcon = ({ className }) => <Icon path="M9 18l6-6-6-6" className={className} />;
const LoaderIcon = () => <div className="loader" />;
const CopyIcon = () => <Icon path="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />;
const SearchIcon = () => <Icon path="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35" />;
const UploadIcon = () => <Icon path="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5-5 5 5M12 15V3" />;
const TrashIcon = () => <Icon path="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />;


// --- Static Step Component ---
const WorkspaceStep = ({ title, children, stepNumber }) => {
    return (
        <div className="workspace-step">
            <header className="step-header">
                <h2>Step {stepNumber}: {title}</h2>
            </header>
            {children}
        </div>
    );
};

// --- View Components ---

const GenerateView = ({ 
  onGenerationComplete,
  script, setScript,
  style, setStyle,
  referenceImage, setReferenceImage,
  referenceImagePreview, setReferenceImagePreview,
  aspectRatio, setAspectRatio,
  numberOfImages, setNumberOfImages,
  scenes, setScenes,
  isGenerating, setIsGenerating,
  globalMessage, setGlobalMessage,
  onClearWorkspace,
}) => {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const previewableScenes = useMemo(() => scenes.filter(s => s.image && !s.error), [scenes]);

  const handleOpenPreview = (sceneId: number) => {
    const index = previewableScenes.findIndex(s => s.id === sceneId);
    if (index !== -1) {
      setPreviewIndex(index);
    }
  };

  const handleClosePreview = () => {
    setPreviewIndex(null);
  };

  const handlePrevImage = () => {
    if (previewIndex !== null) {
      setPreviewIndex(prev => (prev === 0 ? previewableScenes.length - 1 : (prev || 0) - 1));
    }
  };

  const handleNextImage = () => {
    if (previewIndex !== null) {
      setPreviewIndex(prev => ((prev || 0) + 1) % previewableScenes.length);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (referenceImagePreview) {
      URL.revokeObjectURL(referenceImagePreview);
    }
    if (file) {
      setReferenceImage(file);
      setReferenceImagePreview(URL.createObjectURL(file));
    } else {
      setReferenceImage(null);
      setReferenceImagePreview('');
    }
  };

  const handleScriptFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
          const text = event.target?.result as string;
          setScript(text);
      };
      reader.onerror = (error) => {
          console.error("Error reading file:", error);
          setGlobalMessage({text: "Failed to read the script file.", type: 'error'});
      };
      reader.readAsText(file);
      
      e.target.value = ''; 
  };

  const handleDownloadSingle = (imageUrl: string, filename: string) => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const sanitizeFilename = (name: string) => {
    return name
      .toLowerCase()
      .replace(/\s+/g, '_') // replace spaces with underscores
      .replace(/[^a-z0-9_.-]/g, '') // remove most invalid characters
      .substring(0, 100); // truncate
  };

  const handleDownloadAll = async () => {
    const zip = new JSZip();
    scenes.filter(s => s.image).forEach(scene => {
      if (scene.image) {
        const base64Data = scene.image.split(',')[1];
        const filename = `scene_${scene.id + 1}_${sanitizeFilename(scene.prompt)}.jpeg`;
        zip.file(filename, base64Data, { base64: true });
      }
    });
    try {
      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = 'zarrar_image_gen_scenes.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (err: any) {
      setGlobalMessage({text: `Failed to create ZIP file: ${err.message}`, type: 'error'});
    }
  };

  const handleApiError = useCallback((e) => {
        const message = e.message?.toLowerCase() || '';
        let userMessage = `An API error occurred: ${e.message}`;
        if (message.includes('permission denied') || message.includes('api key not valid')) {
            userMessage = 'The configured API key is invalid or has been blocked.';
        } else if (message.includes('quota')) {
            userMessage = 'The API key has exceeded its quota.';
        }
        setGlobalMessage({ text: userMessage, type: 'error' });
    }, [setGlobalMessage]);

    const handleRegenerateScene = useCallback(async (sceneId: number) => {
        const sceneToRegenerate = scenes.find(s => s.id === sceneId);
        if (!sceneToRegenerate) return;

        if (!process.env.API_KEY) {
            setGlobalMessage({ text: 'API key is not configured.', type: 'error' });
            return;
        }

        setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isLoading: true, error: null } : s));
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        let combinedStyle = style.trim();
        if (referenceImage) {
            try {
                const imagePart = await fileToGenerativePart(referenceImage);
                const describeResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: { parts: [imagePart, { text: "Describe the artistic style, subject, mood, and color palette of this image in a few concise keywords, suitable for an image generation prompt." }] },
                });
                combinedStyle = `${describeResponse.text} ${style}`.trim();
            } catch (e) {
                console.error("Error analyzing reference image for regeneration:", e);
                handleApiError(e);
                const finalError = `Ref image error.`;
                setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isLoading: false, error: finalError } : s));
                return;
            }
        }

        try {
            const fullPrompt = `An image of "${sceneToRegenerate.prompt}" in the style of "${combinedStyle}". 4k quality.`;

            const imageResponse = await ai.models.generateImages({
                model: 'imagen-3.0-generate-002',
                prompt: fullPrompt,
                config: { numberOfImages: 1, aspectRatio: aspectRatio, outputMimeType: 'image/jpeg' },
            });

            if (imageResponse.generatedImages && imageResponse.generatedImages.length > 0 && imageResponse.generatedImages[0].image) {
                const imageUrl = `data:image/jpeg;base64,${imageResponse.generatedImages[0].image.imageBytes}`;
                const updatedScene = { ...sceneToRegenerate, image: imageUrl, isLoading: false, error: null };
                setScenes(prev => prev.map(s => s.id === sceneId ? updatedScene : s));
            } else {
                console.warn(`Image regeneration returned no images for prompt: "${sceneToRegenerate.prompt}"`);
                const finalError = 'Regeneration blocked or failed.';
                setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isLoading: false, error: finalError } : s));
            }

        } catch (e: any) {
            console.error(`Image regeneration failed for prompt: "${sceneToRegenerate.prompt}"`, e);
            handleApiError(e);
            const finalError = `API Error.`;
            setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isLoading: false, error: finalError } : s));
        }
    }, [scenes, style, referenceImage, aspectRatio, setScenes, handleApiError, setGlobalMessage]);


  const generateImages = useCallback(async () => {
    if (!script) {
        setGlobalMessage({ text: 'Script cannot be empty.', type: 'error' });
        return;
    }
    
    if (!process.env.API_KEY) {
        setGlobalMessage({ text: 'API key is not configured. Please set the API_KEY environment variable.', type: 'error' });
        return;
    }

    setIsGenerating(true);
    setGlobalMessage(null);
    setScenes([]);
    
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    let finalScenes: Scene[] = [];

    try {
        let combinedStyle = style.trim();
        let promptTexts: string[] = [];

        // Step 1: Generate prompts from the script
        if (referenceImage) {
            try {
                const imagePart = await fileToGenerativePart(referenceImage);
                const describeResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: { parts: [imagePart, { text: "Describe the artistic style, subject, mood, and color palette of this image in a few concise keywords, suitable for an image generation prompt." }] },
                });
                const referenceStyle = describeResponse.text;
                combinedStyle = `${referenceStyle} ${style}`.trim();
            } catch (e) {
                 console.error("Error analyzing reference image:", e);
                 handleApiError(e);
                 setIsGenerating(false);
                 return;
            }
        }

        const numImages = parseInt(numberOfImages, 10);
        const promptToGetPrompts = numImages > 0
            ? `You are a screenwriting assistant. Analyze the following script and generate exactly ${numImages} concise and visually descriptive prompts for an AI image generator. The output must be a JSON array of strings. Do not include any other text outside the JSON array.\n\nSCRIPT:\n${script}`
            : `You are a screenwriting assistant. Analyze the following script and break it down into distinct scenes. For each scene, generate a concise and visually descriptive prompt for an AI image generator. The output must be a JSON array of strings. Do not include any other text outside the JSON array.\n\nSCRIPT:\n${script}`;
        
        let promptsResponse;
        try {
            promptsResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: promptToGetPrompts,
                config: { responseMimeType: "application/json", responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } } },
            });
            promptTexts = JSON.parse(promptsResponse.text);
        } catch(e) {
            console.error("Error generating prompts:", e);
            handleApiError(e);
            setIsGenerating(false);
            return;
        }

        if (!Array.isArray(promptTexts) || promptTexts.length === 0) {
            throw new Error('Could not generate any prompts from the script.');
        }

        const newScenes: Scene[] = promptTexts.map((p, index) => ({ id: index, prompt: p, image: null, isLoading: true, error: null }));
        setScenes(newScenes);

        // Step 2: Generate an image for each prompt
        for (const scene of newScenes) {
            let imageUrl: string | null = null;
            let finalError: string | null = null;

            try {
                const fullPrompt = `An image of "${scene.prompt}" in the style of "${combinedStyle}". 4k quality.`;
                const imageResponse = await ai.models.generateImages({
                    model: 'imagen-3.0-generate-002',
                    prompt: fullPrompt,
                    config: { numberOfImages: 1, aspectRatio: aspectRatio, outputMimeType: 'image/jpeg' },
                });
                
                if (imageResponse.generatedImages && imageResponse.generatedImages.length > 0 && imageResponse.generatedImages[0].image) {
                    imageUrl = `data:image/jpeg;base64,${imageResponse.generatedImages[0].image.imageBytes}`;
                } else {
                    console.warn(`Image generation returned no images for prompt: "${scene.prompt}"`);
                    finalError = 'Generation blocked or failed.';
                }
            } catch (e: any) {
                console.error(`Image generation failed for prompt: "${scene.prompt}"`, e);
                handleApiError(e);
                finalError = `API Error.`;
                // Stop further generation
                setScenes(prev => prev.map(s => ({...s, isLoading: false, error: s.isLoading ? finalError: s.error })));
                setIsGenerating(false);
                return;
            }
            
            const updatedScene = { ...scene, image: imageUrl, isLoading: false, error: finalError };
            finalScenes.push(updatedScene);
            setScenes(prev => prev.map(s => s.id === scene.id ? updatedScene : s));
        }

    } catch (err: any) {
        console.error("An error occurred during the generation process:", err);
        setGlobalMessage({ text: `An error occurred: ${err.message}`, type: 'error' });
        setScenes(prevScenes => prevScenes.map(s => ({ ...s, isLoading: false, error: s.error || "Generation process failed." })));
    } finally {
        setIsGenerating(false);
        if (finalScenes.some(s => s.image)) {
            onGenerationComplete({
                id: new Date().toISOString(),
                timestamp: new Date().toISOString(),
                script,
                scenes: finalScenes.filter(s => !s.isLoading)
            });
        }
    }
}, [
    script, style, referenceImage, aspectRatio, numberOfImages,
    onGenerationComplete, setScenes, setIsGenerating, setGlobalMessage, handleApiError
]);
  
  const showDownloadAll = !isGenerating && scenes.length > 0 && scenes.some(s => s.image);
  const currentPreviewScene = previewIndex !== null ? previewableScenes[previewIndex] : null;

  return (
    <>
      <div className="main-workspace-content">
          <WorkspaceStep title="Provide Script" stepNumber={1}>
              <div className="step-content">
                  <div className="form-group">
                      <div className="label-with-action">
                          <label htmlFor="script-input">Script</label>
                          <label htmlFor="script-upload-input" className="button-secondary upload-button">
                              <UploadIcon /> Upload File
                          </label>
                          <input 
                              id="script-upload-input" 
                              type="file" 
                              accept=".txt,.md" 
                              onChange={handleScriptFileUpload} 
                              style={{ display: 'none' }} 
                              disabled={isGenerating}
                          />
                      </div>
                      <textarea id="script-input" value={script} onChange={(e) => setScript(e.target.value)} placeholder="Paste your script here or upload a file..." disabled={isGenerating} />
                  </div>
              </div>
          </WorkspaceStep>

          <WorkspaceStep title="Define Style & Output" stepNumber={2}>
              <div className="step-content grid-2">
                  <div className="form-group">
                      <label htmlFor="style-input">Additional Style Keywords</label>
                      <input id="style-input" type="text" value={style} onChange={(e) => setStyle(e.target.value)} placeholder="e.g., anime, watercolor" disabled={isGenerating} />
                  </div>
                  <div className="form-group">
                      <label htmlFor="reference-image-input">Reference Image (for style)</label>
                      <div className="custom-file-input">
                          <label htmlFor="reference-image-input" className="custom-file-input-label">
                              <UploadIcon /> Choose File
                          </label>
                          <input 
                            id="reference-image-input" 
                            type="file" 
                            accept="image/*" 
                            onChange={handleFileChange} 
                            disabled={isGenerating} 
                          />
                           <span className="file-name">{referenceImage ? referenceImage.name : 'No file chosen'}</span>
                      </div>
                      {referenceImagePreview && <img src={referenceImagePreview} alt="Reference Preview" className="reference-preview" />}
                  </div>
                  <div className="form-group">
                      <label htmlFor="aspect-ratio">Aspect Ratio</label>
                      <select id="aspect-ratio" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} disabled={isGenerating}>
                          <option value="16:9">16:9 (Widescreen)</option>
                          <option value="9:16">9:16 (Vertical)</option>
                          <option value="1:1">1:1 (Square)</option>
                          <option value="4:3">4:3 (Standard)</option>
                          <option value="3:4">3:4 (Portrait)</option>
                      </select>
                  </div>
                  <div className="form-group">
                      <label htmlFor="num-images-input">Number of Images (Optional)</label>
                      <input id="num-images-input" type="number" min="1" value={numberOfImages} onChange={(e) => setNumberOfImages(e.target.value)} placeholder="Default: auto-detect" disabled={isGenerating} />
                  </div>
              </div>
          </WorkspaceStep>

          <WorkspaceStep title="Generate & Review" stepNumber={3}>
            <div className="step-content">
              {globalMessage && <div className={`message-box message-${globalMessage.type}`}>{globalMessage.text}</div>}
              
              <div className="results-header">
                  <h3>Generated Images</h3>
                  {showDownloadAll && <button onClick={handleDownloadAll} className="button-secondary">Download All (.zip)</button>}
              </div>

              <div className="results-grid">
                {scenes.map((scene) => (
                  <div key={scene.id} className="image-card">
                    <div className="image-wrapper" onClick={() => scene.image && handleOpenPreview(scene.id)}>
                      {scene.isLoading && <div className="image-overlay"><LoaderIcon /></div>}
                      {scene.error && <div className="image-overlay error-message">{scene.error}</div>}
                      {scene.image && <img src={scene.image} alt={scene.prompt} className="generated-image" />}
                    </div>
                    <div className="card-content">
                      <p className="prompt-text">{scene.id + 1}. {scene.prompt}</p>
                      <div className="card-actions">
                        {scene.image && <button className="button-secondary" onClick={() => handleDownloadSingle(scene.image, `scene_${scene.id + 1}.jpeg`)}>Download</button>}
                        {(scene.error || !scene.image) && !scene.isLoading && (
                            <button className="button-secondary" onClick={() => handleRegenerateScene(scene.id)}>
                                Regenerate
                            </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {isGenerating && scenes.length === 0 && <div className="placeholder"><LoaderIcon />Analyzing script and generating prompts...</div>}
              {!isGenerating && scenes.length === 0 && <div className="placeholder">Your generated scenes will appear here.</div>}
            </div>
          </WorkspaceStep>
      </div>
      <footer className="footer">
        <div className="footer-actions">
          <div style={{ marginLeft: 'auto' }} />
          <button className="button-secondary" onClick={onClearWorkspace} disabled={isGenerating}>Clear Workspace</button>
          <button className="button-primary" onClick={generateImages} disabled={isGenerating}>
            {isGenerating ? <><div className="loader-inline" /><span>Generating...</span></> : 'Generate Images'}
          </button>
        </div>
      </footer>
      
      {currentPreviewScene && (
        <div className="modal-overlay" onClick={handleClosePreview}>
           {previewableScenes.length > 1 && (
              <>
                  <button className="modal-nav-button prev" onClick={(e) => { e.stopPropagation(); handlePrevImage(); }}>&#10094;</button>
                  <button className="modal-nav-button next" onClick={(e) => { e.stopPropagation(); handleNextImage(); }}>&#10095;</button>
              </>
          )}
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <button className="modal-close-button" onClick={handleClosePreview}>&times;</button>
              <div className="modal-image-container">
                  <img src={currentPreviewScene.image} alt={currentPreviewScene.prompt} className="modal-image" />
              </div>
              <div className="modal-info">
                  <p className="prompt-text">({(previewIndex || 0) + 1}/{previewableScenes.length}) {currentPreviewScene.prompt}</p>
                  <button className="button-secondary" onClick={() => handleDownloadSingle(currentPreviewScene.image, `scene_${currentPreviewScene.id + 1}_${sanitizeFilename(currentPreviewScene.prompt)}.jpeg`)}>
                      Download
                  </button>
              </div>
          </div>
        </div>
      )}
    </>
  );
};

const DashboardView = ({ sessions, setView }) => {
    const recentSessions = useMemo(() => sessions.slice(-3).reverse(), [sessions]);
    const totalImages = useMemo(() => sessions.reduce((acc, s) => acc + s.scenes.filter(scene => scene.image).length, 0), [sessions]);

    return (
        <div className="dashboard-view">
            <h1>Dashboard</h1>
            <div className="dashboard-grid">
                <div className="dashboard-card">
                    <h3>Total Sessions</h3>
                    <p className="stat-large">{sessions.length}</p>
                    <p>Total generation sessions saved</p>
                </div>
                 <div className="dashboard-card">
                    <h3>Images Generated</h3>
                    <p className="stat-large">{totalImages}</p>
                    <p>Across all saved sessions</p>
                </div>
            </div>
            <h2>Recent Activity</h2>
            <div className="recent-sessions-list">
                {recentSessions.length > 0 ? recentSessions.map(session => (
                    <div key={session.id} className="recent-session-item" onClick={() => setView('assets')}>
                        <p><strong>Session from:</strong> {new Date(session.timestamp).toLocaleString()}</p>
                        <p className="script-preview">"{session.script.substring(0, 100)}..."</p>
                        <button className="button-secondary">View in Assets</button>
                    </div>
                )) : <p>No recent sessions. Generate some images to get started!</p>}
            </div>
        </div>
    );
};

const HistoryView = ({ promptHistory, sessions }: { promptHistory: PromptEntry[], sessions: Session[] }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const promptImageMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const session of sessions) {
            for (const scene of session.scenes) {
                if (scene.image && !map.has(scene.prompt)) {
                    map.set(scene.prompt, scene.image);
                }
            }
        }
        return map;
    }, [sessions]);

    const filteredHistory = useMemo(() =>
        promptHistory
            .filter(p => p.text.toLowerCase().includes(searchTerm.toLowerCase()))
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
        [promptHistory, searchTerm]
    );

    const handleCopy = (prompt: PromptEntry) => {
        navigator.clipboard.writeText(prompt.text);
        setCopiedId(prompt.id);
        setTimeout(() => setCopiedId(null), 1500);
    };

    return (
        <div className="history-view">
            <h1>Prompt History</h1>
            <div className="history-controls">
                <div className="search-bar">
                    <SearchIcon />
                    <input
                        type="text"
                        placeholder="Search prompts..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>
            <div className="history-list">
                {filteredHistory.length > 0 ? (
                    filteredHistory.map(prompt => {
                        const image = promptImageMap.get(prompt.text);
                        return (
                            <div key={prompt.id} className="history-item">
                                {image ? (
                                    <img src={image} alt={prompt.text} className="history-item-image" />
                                ) : (
                                    <div className="history-item-image-placeholder">No Image</div>
                                )}
                                <div className="history-item-content">
                                    <p className="prompt-text">{prompt.text}</p>
                                    <span className="timestamp">Generated on: {new Date(prompt.timestamp).toLocaleString()}</span>
                                </div>
                                <div className="history-item-actions">
                                    <button onClick={() => handleCopy(prompt)} className="button-secondary copy-button">
                                        <CopyIcon />
                                        <span>{copiedId === prompt.id ? 'Copied!' : 'Copy Prompt'}</span>
                                    </button>
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="placeholder full-width-placeholder">
                        {searchTerm ? `No prompts matching "${searchTerm}".` : "Your prompt history will appear here."}
                    </div>
                )}
            </div>
        </div>
    );
};

const AssetsView = ({ sessions, setSessions }) => {
    const [searchTerm, setSearchTerm] = useState('');
    
    const filteredSessions = useMemo(() =>
        sessions
            .filter(s => s.script.toLowerCase().includes(searchTerm.toLowerCase()))
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
        [sessions, searchTerm]
    );

    const handleDeleteSession = (sessionId: string) => {
        if (window.confirm("Are you sure you want to delete this session? This cannot be undone.")) {
            setSessions(prev => prev.filter(s => s.id !== sessionId));
        }
    }

    return (
        <div className="assets-view">
            <h1>Asset Library</h1>
            <div className="history-controls">
                 <div className="search-bar">
                    <SearchIcon />
                    <input type="text" placeholder="Search scripts..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
            </div>
            <div className="assets-list">
                {filteredSessions.length > 0 ? filteredSessions.map(session => (
                    <div key={session.id} className="session-item">
                         <div className="session-header">
                            <div>
                                <h3>Session from {new Date(session.timestamp).toLocaleString()}</h3>
                                <p className="script-preview">"{session.script.substring(0, 200)}..."</p>
                            </div>
                            <button onClick={() => handleDeleteSession(session.id)} className="button-danger">Delete</button>
                         </div>
                         <div className="results-grid">
                            {session.scenes.filter(s => s.image).map(scene => (
                                <div key={scene.id} className="image-card">
                                    <div className="image-wrapper">
                                        <img src={scene.image} alt={scene.prompt} className="generated-image" />
                                    </div>
                                    <div className="card-content">
                                        <p className="prompt-text">{scene.prompt}</p>
                                    </div>
                                </div>
                            ))}
                         </div>
                    </div>
                )) : (
                    <div className="placeholder">No saved sessions found.</div>
                )}
            </div>
        </div>
    );
};

const App = () => {
    const [view, setView] = useState<View>('generate');
    const [globalMessage, setGlobalMessage] = useState<GlobalMessage | null>(null);

    // Session State
    const [sessions, setSessions] = usePersistentState<Session[]>('zarrar-sessions', []);
    const [promptHistory, setPromptHistory] = usePersistentState<PromptEntry[]>('zarrar-promptHistory', []);

    // Generation Workspace State
    const [script, setScript] = usePersistentState('zarrar-script', '');
    const [style, setStyle] = usePersistentState('zarrar-style', '');
    const [referenceImage, setReferenceImage] = useState<File | null>(null); // Cannot persist file objects
    const [referenceImagePreview, setReferenceImagePreview] = useState('');
    const [aspectRatio, setAspectRatio] = usePersistentState('zarrar-aspectRatio', '16:9');
    const [numberOfImages, setNumberOfImages] = usePersistentState('zarrar-numImages', '');
    const [scenes, setScenes] = usePersistentState<Scene[]>('zarrar-scenes', []);
    const [isGenerating, setIsGenerating] = useState(false);

    const handleClearWorkspace = () => {
        setScript('');
        setStyle('');
        setReferenceImage(null);
        if (referenceImagePreview) {
            URL.revokeObjectURL(referenceImagePreview);
        }
        setReferenceImagePreview('');
        setAspectRatio('16:9');
        setNumberOfImages('');
        setScenes([]);
        setIsGenerating(false);
        setGlobalMessage(null);
    };

    const handleGenerationComplete = useCallback((newSession: Session) => {
        const newPrompts = newSession.scenes
            .filter(s => s.prompt)
            .map(s => ({
                id: `${newSession.id}-${s.id}`,
                text: s.prompt,
                timestamp: newSession.timestamp,
            }));
        setPromptHistory(prev => [...prev, ...newPrompts]);

        let sessionsToSave = [...sessions, newSession];
        let saveSuccessful = false;

        while(!saveSuccessful) {
            try {
                // Dry run to see if the data fits in localStorage
                localStorage.setItem('zarrar-sessions-check', JSON.stringify(sessionsToSave));
                localStorage.removeItem('zarrar-sessions-check');
                saveSuccessful = true;
            } catch (e: any) {
                // Check for QuotaExceededError and ensure there are old sessions to remove
                if ((e.name === 'QuotaExceededError' || (e.code && (e.code === 22 || e.code === 1014))) && sessionsToSave.length > 1) {
                    console.warn('Quota exceeded. Removing oldest session to make space.');
                    sessionsToSave.shift(); // remove the oldest session (from the beginning)
                } else {
                    console.error('Could not save new session due to storage error:', e);
                    setGlobalMessage({ text: 'Storage is full. Could not save session. Please clear some assets.', type: 'error' });
                    return; // Abort the save operation
                }
            }
        }
        
        // If we're here, sessionsToSave is a safe size to store
        setSessions(sessionsToSave);

    }, [sessions, setSessions, setPromptHistory, setGlobalMessage]);

    const NavLink = ({ targetView, icon, label }: { targetView: View, icon: JSX.Element, label: string }) => (
        <a href="#" className={`nav-link ${view === targetView ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setView(targetView); }}>
            {icon}
            <span>{label}</span>
        </a>
    );

    const renderView = () => {
        const generateViewProps = {
            onGenerationComplete: handleGenerationComplete,
            script, setScript, style, setStyle, referenceImage, setReferenceImage,
            referenceImagePreview, setReferenceImagePreview, aspectRatio, setAspectRatio,
            numberOfImages, setNumberOfImages, scenes, setScenes, isGenerating, setIsGenerating,
            globalMessage, setGlobalMessage, onClearWorkspace: handleClearWorkspace
        };

        switch(view) {
            case 'dashboard': return <DashboardView sessions={sessions} setView={setView} />;
            case 'history': return <HistoryView promptHistory={promptHistory} sessions={sessions} />;
            case 'assets': return <AssetsView sessions={sessions} setSessions={setSessions} />;
            case 'generate':
            default:
                return <GenerateView {...generateViewProps} />;
        }
    };

    return (
        <div className="app-layout">
            <aside className="sidebar">
                <div className="sidebar-header">
                    <div className="logo"><LogoIcon /></div>
                    <h1>Zarrar Image Gen</h1>
                </div>
                <nav className="sidebar-nav">
                    <NavLink targetView="generate" icon={<GenerateIcon/>} label="Generate Center" />
                    <NavLink targetView="dashboard" icon={<DashboardIcon/>} label="Dashboard" />
                    <NavLink targetView="history" icon={<HistoryIcon/>} label="Prompt History" />
                    <NavLink targetView="assets" icon={<AssetsIcon/>} label="Asset Library" />
                </nav>
            </aside>
            <main className="main-workspace">
                {renderView()}
            </main>
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><App /></React.StrictMode>);