import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Volume2, Moon, Sun, Square, X } from 'lucide-react';

export default function VoiceAgent() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [conversationHistory, setConversationHistory] = useState([]);
  const [darkMode, setDarkMode] = useState(false);
  const [continuousMode, setContinuousMode] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // API Keys from environment variables
  const apiKeys = {
    deepgram: import.meta.env.VITE_DEEPGRAM_API_KEY || '',
    groq: import.meta.env.VITE_GROQ_API_KEY || '',
    murf: import.meta.env.VITE_MURF_API_KEY || ''
  };

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);
  const audioRef = useRef(null); // For Murf audio playback

  // Check API configuration on mount
  useEffect(() => {
    if (!apiKeys.groq) {
      setStatus('⚠️ Groq API key not configured');
    } else if (apiKeys.murf) {
      setStatus('Ready (GROQ + MURF Voice)');
    } else {
      setStatus('Ready (GROQ)');
    }
  }, []);

  // Cleanup speech on unmount or page refresh
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      handleBeforeUnload();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Initialize Web Speech API
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-IN';

      recognitionRef.current.onresult = (event) => {
        const current = event.resultIndex;
        const transcriptText = event.results[current][0].transcript;
        setTranscript(transcriptText);
        
        if (event.results[current].isFinal) {
          handleTranscriptComplete(transcriptText);
        }
      };

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setStatus(`Error: ${event.error}`);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  // Auto-focus input after speaking ends in continuous mode
  useEffect(() => {
    if (!isSpeaking && !isGenerating && continuousMode && inputRef.current) {
      setTimeout(() => {
        inputRef.current.focus();
      }, 500);
    }
  }, [isSpeaking, isGenerating, continuousMode]);

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsGenerating(false);
    setStatus('Generation stopped');
    setTimeout(() => setStatus('Ready (GROQ)'), 2000);
  };

  const stopSpeaking = () => {
    // Stop Web Speech API
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
    
    // Stop Murf audio playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    
    setIsSpeaking(false);
    setStatus('Ready (GROQ)');
  };

  const toggleSpeaking = () => {
    if (isSpeaking) {
      stopSpeaking();
    } else if (response) {
      speakResponse(response);
    }
  };

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const startListening = async () => {
    try {
      setStatus('Listening...');
      setTranscript('');
      setIsListening(true);

      if (recognitionRef.current) {
        recognitionRef.current.start();
      } else {
        if (apiKeys.deepgram) {
          await startDeepgramRecording();
        } else {
          setStatus('Speech recognition not available');
          setIsListening(false);
        }
      }
    } catch (error) {
      console.error('Error starting recognition:', error);
      setStatus('Error starting microphone');
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsListening(false);
    setStatus('Processing...');
  };

  const startDeepgramRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorderRef.current = new MediaRecorder(stream);
    audioChunksRef.current = [];

    mediaRecorderRef.current.ondataavailable = (event) => {
      audioChunksRef.current.push(event.data);
    };

    mediaRecorderRef.current.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      await transcribeWithDeepgram(audioBlob);
      stream.getTracks().forEach(track => track.stop());
    };

    mediaRecorderRef.current.start();
  };

  const transcribeWithDeepgram = async (audioBlob) => {
    try {
      const response = await fetch('https://api.deepgram.com/v1/listen', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKeys.deepgram}`,
          'Content-Type': 'audio/webm'
        },
        body: audioBlob
      });

      const data = await response.json();
      const transcriptText = data.results?.channels[0]?.alternatives[0]?.transcript || '';
      setTranscript(transcriptText);
      handleTranscriptComplete(transcriptText);
    } catch (error) {
      console.error('Deepgram error:', error);
      setStatus('Transcription error');
    }
  };

  const handleTranscriptComplete = async (text) => {
    if (!text.trim()) {
      setStatus('No speech detected');
      return;
    }

    setStatus('Thinking...');
    setIsGenerating(true);
    
    const newHistory = [...conversationHistory, { role: 'user', content: text }];
    setConversationHistory(newHistory);

    abortControllerRef.current = new AbortController();
    const aiResponse = await getAIResponse(text, newHistory, abortControllerRef.current.signal);
    
    if (aiResponse && !abortControllerRef.current.signal.aborted) {
      setResponse(aiResponse);
      const updatedHistory = [...newHistory, { role: 'assistant', content: aiResponse }];
      setConversationHistory(updatedHistory);
      
      await speakResponse(aiResponse);
    }
    
    setIsGenerating(false);
    setStatus('Ready (GROQ)');
  };

  const getAIResponse = async (userMessage, history, signal) => {
    if (!apiKeys.groq) {
      setStatus('Groq API key not configured');
      return 'Please configure your Groq API key in the .env file.';
    }

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKeys.groq}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: history,
          temperature: 0.7,
          max_tokens: 1024
        }),
        signal
      });

      if (!response.ok) throw new Error(`Groq API Error: ${response.status}`);
      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      if (error.name === 'AbortError') {
        return null;
      }
      console.error('AI response error:', error);
      setStatus('Error getting AI response');
      return 'I apologize, but I encountered an error. Please check your API configuration.';
    }
  };

  const speakResponse = async (text) => {
    setIsSpeaking(true);
    setStatus('Speaking...');
    
    try {
      // Always try Murf first if API key is available
      if (apiKeys.murf) {
        const success = await speakWithMurf(text);
        if (success) return;
      }
      // Fallback to Web Speech API
      speakWithWebAPI(text);
    } catch (error) {
      console.error('Speech error:', error);
      setStatus('Error speaking response');
      setIsSpeaking(false);
    }
  };

  const speakWithMurf = async (text) => {
    try {
      // Using Murf's Gen2 API endpoint
      const response = await fetch('https://api.murf.ai/v1/speech/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKeys.murf
        },
        body: JSON.stringify({
          voiceId: 'en-IN-priya',  // Using a valid Gen2 voice ID
          style: 'Conversational',
          text: text,
          rate: 0,
          pitch: 0,
          sampleRate: 24000,
          format: 'MP3',
          channelType: 'MONO',
          pronunciationDictionary: {},
          encodeAsBase64: false,
          variation: 1,
          modelVersion: 'GEN2'
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn('Murf API failed:', response.status, errorText);
        return false;
      }

      // Parse response
      const data = await response.json();
      
      // Murf Gen2 returns audioFile URL
      if (!data.audioFile) {
        console.warn('No audio file in Murf response:', data);
        return false;
      }

      const audio = new Audio(data.audioFile);
      audioRef.current = audio;
      
      audio.onended = () => {
        setIsSpeaking(false);
        setStatus('Ready (GROQ)');
        audioRef.current = null;
      };
      
      audio.onerror = (e) => {
        console.error('Audio playback error:', e);
        setIsSpeaking(false);
        setStatus('Ready (GROQ)');
        audioRef.current = null;
      };
      
      await audio.play();
      return true;
    } catch (error) {
      console.error('Murf API error:', error);
      return false;
    }
  };

  const speakWithWebAPI = (text) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.85; // Slower for softer sound
      utterance.pitch = 0.9; // Lower pitch
      utterance.volume = 0.75; // Softer volume
      
      utterance.onend = () => {
        setIsSpeaking(false);
        setStatus('Ready (GROQ)');
      };
      
      utterance.onerror = () => {
        setIsSpeaking(false);
        setStatus('Ready (GROQ)');
      };
      
      window.speechSynthesis.speak(utterance);
    } else {
      setIsSpeaking(false);
      setStatus('Ready (GROQ)');
    }
  };

  const clearConversation = () => {
    setConversationHistory([]);
    setTranscript('');
    setResponse('');
    setStatus('Ready (GROQ)');
  };

  const formatText = (text) => {
    const lines = text.split('\n');
    
    return lines.map((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) return <br key={idx} />;
      
      if (trimmed.startsWith('#')) {
        const level = trimmed.match(/^#+/)[0].length;
        const content = trimmed.replace(/^#+\s*/, '');
        const className = level === 1 ? 'text-xl font-bold mt-4 mb-2' :
                         level === 2 ? 'text-lg font-bold mt-3 mb-2' :
                         'text-base font-bold mt-2 mb-1';
        return <div key={idx} className={className}>{content}</div>;
      }
      
      if (trimmed.endsWith(':') && trimmed.length < 100) {
        return <div key={idx} className="font-bold mt-3 mb-1">{trimmed}</div>;
      }
      
      if (/^\d+\./.test(trimmed)) {
        return (
          <div key={idx} className="ml-4 mb-1 flex gap-2">
            <span className="font-semibold">{trimmed.match(/^\d+\./)[0]}</span>
            <span>{trimmed.replace(/^\d+\.\s*/, '')}</span>
          </div>
        );
      }
      
      if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
        return (
          <div key={idx} className="ml-4 mb-1 flex gap-2">
            <span>•</span>
            <span>{trimmed.replace(/^[•\-*]\s*/, '')}</span>
          </div>
        );
      }
      
      const boldRegex = /(\*\*|__)(.*?)\1/g;
      if (boldRegex.test(trimmed)) {
        const parts = trimmed.split(boldRegex);
        return (
          <div key={idx} className="mb-2">
            {parts.map((part, i) => {
              if (part === '**' || part === '__') return null;
              if (i > 0 && (parts[i - 1] === '**' || parts[i - 1] === '__')) {
                return <strong key={i}>{part}</strong>;
              }
              return <span key={i}>{part}</span>;
            })}
          </div>
        );
      }
      
      return <div key={idx} className="mb-2">{trimmed}</div>;
    });
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 p-4 ${
      darkMode 
        ? 'bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900' 
        : 'bg-gradient-to-br from-indigo-100 via-purple-50 to-pink-100'
    }`}>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className={`rounded-2xl shadow-xl p-6 mb-6 transition-colors ${
          darkMode ? 'bg-gray-800' : 'bg-white'
        }`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className={`text-3xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                Voice Agent
              </h1>
              <p className={`mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Powered by Groq AI
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Stop Generation Button */}
              {isGenerating && (
                <button
                  onClick={stopGeneration}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  <Square className="w-4 h-4" />
                  Stop Generation
                </button>
              )}
              
              {/* Start/Stop Speaking Button */}
              {response && (
                <button
                  onClick={toggleSpeaking}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    isSpeaking
                      ? 'bg-orange-500 hover:bg-orange-600 text-white'
                      : 'bg-green-500 hover:bg-green-600 text-white'
                  }`}
                >
                  {isSpeaking ? (
                    <>
                      <X className="w-4 h-4" />
                      Stop Speaking
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-4 h-4" />
                      Start Speaking
                    </>
                  )}
                </button>
              )}
              
              {/* Continuous Mode Toggle */}
              <button
                onClick={() => setContinuousMode(!continuousMode)}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  continuousMode
                    ? 'bg-green-500 text-white'
                    : darkMode
                    ? 'bg-gray-700 text-gray-300'
                    : 'bg-gray-200 text-gray-700'
                }`}
              >
                {continuousMode ? '🔄 Continuous' : '⏸️ Manual'}
              </button>
              
              {/* Dark Mode Toggle */}
              <button
                onClick={() => setDarkMode(!darkMode)}
                className={`p-3 rounded-full transition-colors ${
                  darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'
                }`}
              >
                {darkMode ? (
                  <Sun className="w-6 h-6 text-yellow-400" />
                ) : (
                  <Moon className="w-6 h-6 text-gray-600" />
                )}
              </button>
            </div>
          </div>

          {/* Status */}
          <div className="flex items-center gap-2 text-sm">
            <div className={`w-2 h-2 rounded-full ${
              isListening ? 'bg-red-500 animate-pulse' : 
              isSpeaking ? 'bg-blue-500 animate-pulse' : 
              isGenerating ? 'bg-yellow-500 animate-pulse' :
              'bg-green-500'
            }`} />
            <span className={`font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {status}
            </span>
          </div>
        </div>

        {/* Main Interface */}
        <div className={`rounded-2xl shadow-xl p-8 transition-colors ${
          darkMode ? 'bg-gray-800' : 'bg-white'
        }`}>
          {/* Microphone Button */}
          <div className="flex justify-center mb-8">
            <button
              onClick={toggleListening}
              disabled={isSpeaking || isGenerating}
              className={`w-32 h-32 rounded-full flex items-center justify-center transition-all transform hover:scale-105 active:scale-95 shadow-2xl ${
                isListening
                  ? 'bg-red-500 hover:bg-red-600 animate-pulse'
                  : (isSpeaking || isGenerating)
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-br from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700'
              }`}
            >
              {isListening ? (
                <MicOff className="w-16 h-16 text-white" />
              ) : (
                <Mic className="w-16 h-16 text-white" />
              )}
            </button>
          </div>

          {/* Instructions */}
          <p className={`text-center mb-6 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {isListening
              ? 'Listening... Speak now'
              : isSpeaking
              ? 'Speaking...'
              : isGenerating
              ? 'Generating response...'
              : 'Click the microphone to start talking or type below'}
          </p>

          {/* Text Input Area */}
          <div className="mb-6">
            <label className={`block text-sm font-medium mb-2 ${
              darkMode ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Type Your Message:
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                placeholder="Type your message here..."
                className={`flex-1 px-4 py-3 rounded-lg border-2 transition-colors ${
                  darkMode
                    ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400 focus:border-indigo-500'
                    : 'bg-white border-gray-300 text-gray-900 focus:border-indigo-500'
                } focus:ring-2 focus:ring-indigo-500 focus:outline-none`}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && e.target.value.trim()) {
                    handleTranscriptComplete(e.target.value);
                    e.target.value = '';
                  }
                }}
                disabled={isListening || isSpeaking || isGenerating}
              />
              <button
                onClick={(e) => {
                  const input = inputRef.current;
                  if (input.value.trim()) {
                    handleTranscriptComplete(input.value);
                    input.value = '';
                  }
                }}
                disabled={isListening || isSpeaking || isGenerating}
                className="px-6 py-3 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                Send
              </button>
            </div>
          </div>

          {/* Conversation Display */}
          <div className="space-y-4">
            {conversationHistory.length > 0 && (
              <div className={`max-h-96 overflow-y-auto space-y-4 p-4 rounded-xl ${
                darkMode ? 'bg-gray-700' : 'bg-gray-50'
              }`}>
                {conversationHistory.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                        msg.role === 'user'
                          ? 'bg-indigo-500 text-white'
                          : darkMode
                          ? 'bg-gradient-to-r from-purple-900 to-indigo-900 text-gray-100 shadow-md border-2 border-indigo-500'
                          : 'bg-gradient-to-r from-purple-50 to-indigo-50 text-gray-800 shadow-md border-2 border-indigo-200'
                      }`}
                    >
                      <p className="text-sm font-medium mb-1 opacity-75">
                        {msg.role === 'user' ? 'You' : 'AI Assistant'}
                      </p>
                      <div>{formatText(msg.content)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Current Transcript */}
            {transcript && (
              <div className={`p-4 rounded-xl border-2 ${
                darkMode
                  ? 'bg-gray-700 border-indigo-500'
                  : 'bg-indigo-50 border-indigo-200'
              }`}>
                <p className={`text-sm font-medium mb-1 ${
                  darkMode ? 'text-indigo-300' : 'text-indigo-700'
                }`}>
                  Current Transcript:
                </p>
                <p className={darkMode ? 'text-gray-200' : 'text-gray-800'}>{transcript}</p>
              </div>
            )}
          </div>

          {/* Clear Button */}
          {conversationHistory.length > 0 && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={clearConversation}
                className={`px-6 py-2 rounded-lg transition-colors ${
                  darkMode
                    ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                    : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                }`}
              >
                Clear Conversation
              </button>
            </div>
          )}
        </div>

        {/* Info Panel */}
        <div className={`mt-6 rounded-2xl shadow-xl p-6 transition-colors ${
          darkMode ? 'bg-gray-800' : 'bg-white'
        }`}>
          <h3 className={`text-lg font-bold mb-3 ${darkMode ? 'text-white' : 'text-gray-800'}`}>
            Features
          </h3>
          <ul className={`space-y-2 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-1">✓</span>
              <span>Real-time speech recognition with softer voice output</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-1">✓</span>
              <span>High-quality voice synthesis with Murf AI (1M free characters)</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-1">✓</span>
              <span>Powered by Groq AI (FREE & Super Fast)</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-1">✓</span>
              <span>Manual stop controls for generation and speaking</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-1">✓</span>
              <span>Continuous chat mode for seamless conversation</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-1">✓</span>
              <span>Dark/Light theme toggle</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-1">✓</span>
              <span>Secure API key management via environment variables</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
