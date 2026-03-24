/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { Mic, MicOff, Volume2, VolumeX, Loader2, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Sophie's Resume Data for System Instruction
const SOPHIE_RESUME = `
Name: Sophie Higander
Title: Fashion Business Student
Contact: +46737868180, sophiee.higander@gmail.com

Profile: Second year fashion Business student at ESMOD Paris seeking a 3 month office based internship in marketing, communication, commercial or PR sectors starting from May. Experienced in fashion and service industries, with skills in sales support, visual merchandising and customer service.

Experience:
- Sales Advisor Intern - Schiaparelli (July 2025 - Sept 2025): Ready-to-Wear and Haute Couture. Assisted clients, styled couture looks, visual merchandising, managed fitting rooms.
- Dresser - Vivienne Westwood (March 2025): Paris Fashion Week. Assisted models, ensured garments were fitted/styled.
- Press Assistant Intern - AELIS (Jan 2025): Paris Fashion Week. Managed guest check-in, smooth entry for press, seating arrangements.
- Hotel Receptionist - Scandic strömmen (July 2024 - Aug 2024): Check-in/out, reservations, guest inquiries.
- Waitress - Tao Noi (2023): Customer service, staff training, billing.

Education:
- ESMOD PARIS: Bachelor Fashion and business (Currently studying, 2024 start).
- KUNGSGÅRD HIGH SCHOOL: Certified economics high school diploma (2020-2023).
- SWEDISH HIGH SCHOOL NAIROBI: Economics and Model UN (2021-2022).

Certificates:
- INSIDE LVMH CERTIFICATE (Nov 2025)
- EF PARIS: B1 diploma of French (2024)

Skills: Luxury Customer Service, Adaptability, Cooperation skills, Proactive.
Software: Microsoft programs (Excel, PPT, Word), Adobe programs (InDesign, Photoshop).
Languages: Swedish (Native), English (Proficient), French (Intermediate), Swahili (Basic).
`;

const SYSTEM_INSTRUCTION = `
You are Ricardo, the sophisticated voice assistant for Sophie Higander.
Personality:
- You speak English and French.
- You have a distinct and charming Milanese Italian accent (Milanaise Italien).
- You are professional yet warm, like a high-end concierge or a dedicated personal assistant in the fashion industry.
- You are very knowledgeable about Sophie's background, education, and professional experience.

Guidelines:
- To start the conversation, you MUST always say: "okaii, my name is Ricardo. what would you like to know about Sophie"
- Use Sophie's resume data provided below to answer questions about her.
- If asked a question not related to Sophie, politely steer the conversation back to her or answer as her assistant.
- Keep responses concise and engaging for a voice interaction.
- If the user speaks French, respond in French with your Milanese accent.

Sophie's Resume Data:
${SOPHIE_RESUME}
`;

export default function App() {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);

  // Initialize Audio Context
  const initAudio = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
  };

  const playAudioChunk = async (pcmData: Int16Array) => {
    if (!audioContextRef.current) return;

    const floatData = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      floatData[i] = pcmData[i] / 32768.0;
    }

    const buffer = audioContextRef.current.createBuffer(1, floatData.length, 16000);
    buffer.getChannelData(0).set(floatData);

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    
    source.onended = () => {
      if (audioQueueRef.current.length > 0) {
        const nextChunk = audioQueueRef.current.shift()!;
        playAudioChunk(nextChunk);
      } else {
        isPlayingRef.current = false;
        setIsSpeaking(false);
      }
    };

    setIsSpeaking(true);
    source.start();
  };

  const startSession = async () => {
    try {
      setIsConnecting(true);
      setError(null);
      await initAudio();

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const session = await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          generationConfig: {
            temperature: 0.7,
          }
        },
        callbacks: {
          onopen: async () => {
            console.log("Ricardo is online.");
            setIsConnecting(false);
            setIsActive(true);
            
            // Start microphone
            streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = audioContextRef.current!.createMediaStreamSource(streamRef.current);
            processorRef.current = audioContextRef.current!.createScriptProcessor(4096, 1, 1);

            processorRef.current.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmData = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
              }
              
              const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
              session.sendRealtimeInput({
                audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
              });
            };

            source.connect(processorRef.current);
            processorRef.current.connect(audioContextRef.current!.destination);
          },
          onmessage: (message) => {
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  const binaryString = atob(part.inlineData.data);
                  const bytes = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  const pcmData = new Int16Array(bytes.buffer);
                  
                  if (isPlayingRef.current) {
                    audioQueueRef.current.push(pcmData);
                  } else {
                    isPlayingRef.current = true;
                    playAudioChunk(pcmData);
                  }
                }
              }
            }

            if (message.serverContent?.interrupted) {
              audioQueueRef.current = [];
              isPlayingRef.current = false;
              setIsSpeaking(false);
            }
          },
          onerror: (err) => {
            console.error("Ricardo encountered an error:", err);
            setError("Connection lost. Please try again.");
            stopSession();
          },
          onclose: () => {
            console.log("Ricardo has left the building.");
            stopSession();
          }
        }
      });

      sessionRef.current = session;
    } catch (err) {
      console.error("Failed to start Ricardo:", err);
      setError("Could not connect to Ricardo. Check your microphone and connection.");
      setIsConnecting(false);
    }
  };

  const stopSession = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    setIsActive(false);
    setIsSpeaking(false);
    audioQueueRef.current = [];
    isPlayingRef.current = false;
  };

  const toggleSession = () => {
    if (isActive) {
      stopSession();
    } else {
      startSession();
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0502] text-[#f5f2ed] font-serif selection:bg-[#ff4e00]/30 overflow-hidden relative">
      {/* Immersive Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div 
          className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full opacity-20 blur-[120px]"
          style={{ background: 'radial-gradient(circle, #ff4e00 0%, transparent 70%)' }}
        />
        <div 
          className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full opacity-10 blur-[120px]"
          style={{ background: 'radial-gradient(circle, #3a1510 0%, transparent 70%)' }}
        />
      </div>

      <main className="relative z-10 max-w-4xl mx-auto px-6 pt-24 pb-12 flex flex-col items-center justify-center min-h-screen">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 }}
          className="text-center mb-16"
        >
          <h1 className="text-7xl md:text-9xl font-light tracking-tighter mb-4 italic">Ricardo</h1>
          <p className="text-sm uppercase tracking-[0.3em] opacity-60 font-sans">Sophie Higander's Personal Assistant</p>
        </motion.div>

        <div className="relative group">
          {/* Visualizer Ring */}
          <AnimatePresence>
            {isActive && (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ 
                  scale: isSpeaking ? [1, 1.1, 1] : 1,
                  opacity: 1,
                  rotate: 360
                }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ 
                  scale: { repeat: Infinity, duration: 2 },
                  rotate: { repeat: Infinity, duration: 20, ease: "linear" }
                }}
                className="absolute inset-[-40px] border border-[#ff4e00]/30 rounded-full border-dashed"
              />
            )}
          </AnimatePresence>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={toggleSession}
            disabled={isConnecting}
            className={`
              relative z-20 w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500
              ${isActive 
                ? 'bg-[#ff4e00] text-white shadow-[0_0_50px_rgba(255,78,0,0.4)]' 
                : 'bg-[#f5f2ed]/10 text-[#f5f2ed] hover:bg-[#f5f2ed]/20 backdrop-blur-xl border border-[#f5f2ed]/20'
              }
            `}
          >
            {isConnecting ? (
              <Loader2 className="w-10 h-10 animate-spin" />
            ) : isActive ? (
              <Mic className="w-10 h-10" />
            ) : (
              <MicOff className="w-10 h-10 opacity-60" />
            )}
          </motion.button>
        </div>

        <div className="mt-16 h-24 flex flex-col items-center justify-center text-center max-w-md">
          <AnimatePresence mode="wait">
            {!isActive && !isConnecting && (
              <motion.p
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-lg italic opacity-40"
              >
                "okaii, my name is Ricardo..."
              </motion.p>
            )}
            {isConnecting && (
              <motion.p
                key="connecting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-lg italic flex items-center gap-2"
              >
                Connecting to Milan... <Sparkles className="w-4 h-4 animate-pulse" />
              </motion.p>
            )}
            {isActive && (
              <motion.div
                key="active"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4"
              >
                <div className="flex items-center gap-3">
                  {isSpeaking ? (
                    <Volume2 className="w-5 h-5 text-[#ff4e00] animate-bounce" />
                  ) : (
                    <VolumeX className="w-5 h-5 opacity-30" />
                  )}
                  <span className="text-sm uppercase tracking-widest opacity-60">
                    {isSpeaking ? "Ricardo is speaking" : "Ricardo is listening"}
                  </span>
                </div>
                <p className="text-sm opacity-40 font-sans">Speak naturally in English or French</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {error && (
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-8 text-red-400 text-sm font-sans"
          >
            {error}
          </motion.p>
        )}

        <footer className="mt-auto pt-12 text-[10px] uppercase tracking-[0.4em] opacity-30 font-sans text-center">
          Milan &bull; Paris &bull; Stockholm
        </footer>
      </main>

      {/* Glass Morphism Info Card */}
      <div className="fixed bottom-8 right-8 z-30 hidden lg:block">
        <div className="p-6 bg-[#f5f2ed]/5 backdrop-blur-2xl border border-[#f5f2ed]/10 rounded-3xl max-w-xs">
          <h3 className="text-xs uppercase tracking-widest mb-3 opacity-60">About Sophie</h3>
          <p className="text-sm leading-relaxed opacity-80 italic">
            "A second-year Fashion Business student at ESMOD Paris, with a passion for luxury and visual merchandising."
          </p>
        </div>
      </div>
    </div>
  );
}
