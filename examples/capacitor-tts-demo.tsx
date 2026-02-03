'use client';

import { useTextToSpeech } from '@/hooks/useTextToSpeech';
import { useEffect, useState } from 'react';

/**
 * Demo component showing all Capacitor TTS features
 * This demonstrates how to use the @capacitor-community/text-to-speech plugin
 */
export default function CapacitorTTSDemo() {
    const {
        speak,
        stop,
        isSpeaking,
        getSupportedLanguages,
        getSupportedVoices,
        isLanguageSupported,
        supportedLanguages,
        supportedVoices
    } = useTextToSpeech();

    const [text, setText] = useState('This is a sample text.');
    const [selectedLang, setSelectedLang] = useState('en-US');
    const [rate, setRate] = useState(1.0);
    const [pitch, setPitch] = useState(1.0);
    const [volume, setVolume] = useState(1.0);
    const [langSupported, setLangSupported] = useState<boolean | null>(null);

    useEffect(() => {
        // Load supported languages and voices on mount
        getSupportedLanguages();
        getSupportedVoices();
    }, [getSupportedLanguages, getSupportedVoices]);

    const handleSpeak = async () => {
        await speak(text, {
            lang: selectedLang,
            rate,
            pitch,
            volume
        });
    };

    const handleStop = async () => {
        await stop();
    };

    const checkLanguageSupport = async () => {
        const supported = await isLanguageSupported(selectedLang);
        setLangSupported(supported);
    };

    return (
        <div className="max-w-4xl mx-auto p-6">
            <h1 className="text-3xl font-bold mb-6">Capacitor TTS Demo</h1>

            {/* Text Input */}
            <div className="mb-6">
                <label className="block text-sm font-medium mb-2">
                    Text to Speak:
                </label>
                <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className="w-full p-3 border rounded-lg"
                    rows={4}
                    placeholder="Enter text to speak..."
                />
            </div>

            {/* Language Selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                    <label className="block text-sm font-medium mb-2">
                        Language:
                    </label>
                    <select
                        value={selectedLang}
                        onChange={(e) => setSelectedLang(e.target.value)}
                        className="w-full p-2 border rounded"
                    >
                        {supportedLanguages.length > 0 ? (
                            supportedLanguages.map((lang) => (
                                <option key={lang} value={lang}>
                                    {lang}
                                </option>
                            ))
                        ) : (
                            <option value="en-US">en-US</option>
                        )}
                    </select>
                    <button
                        onClick={checkLanguageSupport}
                        className="mt-2 text-sm text-blue-600 hover:underline"
                    >
                        Check if language is supported
                    </button>
                    {langSupported !== null && (
                        <p className="mt-1 text-sm">
                            {langSupported ? '✅ Supported' : '❌ Not supported'}
                        </p>
                    )}
                </div>

                <div>
                    <label className="block text-sm font-medium mb-2">
                        Voice:
                    </label>
                    <select className="w-full p-2 border rounded">
                        {supportedVoices.length > 0 ? (
                            supportedVoices.map((voice, index) => (
                                <option key={index} value={index}>
                                    {voice.name} ({voice.lang})
                                </option>
                            ))
                        ) : (
                            <option>Loading voices...</option>
                        )}
                    </select>
                </div>
            </div>

            {/* Speech Parameters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div>
                    <label className="block text-sm font-medium mb-2">
                        Rate: {rate.toFixed(1)}
                    </label>
                    <input
                        type="range"
                        min="0.1"
                        max="2.0"
                        step="0.1"
                        value={rate}
                        onChange={(e) => setRate(Number(e.target.value))}
                        className="w-full"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        Speed of speech (0.1 - 2.0)
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-medium mb-2">
                        Pitch: {pitch.toFixed(1)}
                    </label>
                    <input
                        type="range"
                        min="0.1"
                        max="2.0"
                        step="0.1"
                        value={pitch}
                        onChange={(e) => setPitch(Number(e.target.value))}
                        className="w-full"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        Voice pitch (0.1 - 2.0)
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-medium mb-2">
                        Volume: {volume.toFixed(1)}
                    </label>
                    <input
                        type="range"
                        min="0.0"
                        max="1.0"
                        step="0.1"
                        value={volume}
                        onChange={(e) => setVolume(Number(e.target.value))}
                        className="w-full"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        Speaker volume (0.0 - 1.0)
                    </p>
                </div>
            </div>

            {/* Control Buttons */}
            <div className="flex gap-4 mb-6">
                <button
                    onClick={handleSpeak}
                    disabled={isSpeaking}
                    className={`px-6 py-3 rounded-lg font-medium ${isSpeaking
                            ? 'bg-gray-300 cursor-not-allowed'
                            : 'bg-blue-500 text-white hover:bg-blue-600'
                        }`}
                >
                    {isSpeaking ? '🔊 Speaking...' : '▶️ Speak'}
                </button>

                {isSpeaking && (
                    <button
                        onClick={handleStop}
                        className="px-6 py-3 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600"
                    >
                        ⏹️ Stop
                    </button>
                )}
            </div>

            {/* Status Display */}
            {isSpeaking && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center gap-3">
                        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                        <div>
                            <p className="font-medium text-green-800">Currently Speaking</p>
                            <p className="text-sm text-green-600">
                                Language: {selectedLang} | Rate: {rate} | Pitch: {pitch}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Info Section */}
            <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h2 className="font-semibold text-blue-900 mb-2">📋 Information</h2>
                <ul className="text-sm text-blue-800 space-y-1">
                    <li>• Supported Languages: {supportedLanguages.length || 'Loading...'}</li>
                    <li>• Available Voices: {supportedVoices.length || 'Loading...'}</li>
                    <li>• Current Status: {isSpeaking ? 'Speaking' : 'Idle'}</li>
                </ul>
            </div>
        </div>
    );
}
