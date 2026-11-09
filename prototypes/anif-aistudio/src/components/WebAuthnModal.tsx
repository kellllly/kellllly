import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Fingerprint,
  ShieldCheck,
  Lock,
  KeyRound,
  X,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  RefreshCw,
  Sparkles,
  Smartphone,
  Eye,
  Scan,
  Terminal,
  Laptop
} from 'lucide-react';
import { UserProfile } from '../types';
import {
  SensitiveAction,
  WebAuthnAssertionResult,
  checkWebAuthnCapability,
  detectBiometricLabel,
  authenticateWithWebAuthn,
  verifyFido2PinBackup,
  generateWebAuthnChallenge,
  bufferToHex,
  createRegistrationOptions
} from '../utils/webauthn';
import { cyberAudio } from '../utils/audio';

interface WebAuthnModalProps {
  isOpen: boolean;
  onClose: () => void;
  action: SensitiveAction | null;
  currentUser: UserProfile;
  onAuthorized: (assertion: WebAuthnAssertionResult) => void;
  onFailedAuth?: (action: SensitiveAction, reason: string) => void;
}

export const WebAuthnModal: React.FC<WebAuthnModalProps> = ({
  isOpen,
  onClose,
  action,
  currentUser,
  onAuthorized,
  onFailedAuth
}) => {
  const [isCheckingCapability, setIsCheckingCapability] = useState(true);
  const [isPlatformAvailable, setIsPlatformAvailable] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<WebAuthnAssertionResult | null>(null);
  const [activeMode, setActiveMode] = useState<'biometric' | 'pin' | 'inspector'>('biometric');
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState<string | null>(null);

  const biometricInfo = detectBiometricLabel();

  // Vérification de la disponibilité matérielle WebAuthn
  useEffect(() => {
    if (!isOpen) {
      setAuthError(null);
      setAuthSuccess(null);
      setPinInput('');
      setPinError(null);
      setRegistrationSuccess(null);
      return;
    }

    async function probeCapability() {
      setIsCheckingCapability(true);
      const cap = await checkWebAuthnCapability();
      setIsPlatformAvailable(cap.isPlatformAuthenticatorAvailable);
      setIsCheckingCapability(false);
    }
    probeCapability();
  }, [isOpen]);

  if (!isOpen || !action) return null;

  // Lancement de l'authentification biométrique WebAuthn réelle
  const handleTriggerBiometric = async () => {
    setIsAuthenticating(true);
    setAuthError(null);
    cyberAudio.playCryptoBip();

    try {
      const result = await authenticateWithWebAuthn(action, currentUser);

      if (result.success) {
        cyberAudio.playCryptoBip();
        setAuthSuccess(result);
        setTimeout(() => {
          onAuthorized(result);
        }, 800);
      } else {
        // En cas d'erreur ou d'absence de capteur configuré
        cyberAudio.playShieldBlock();
        const errMsg = result.error || "L'authentificateur biométrique local n'a pas répondu ou a été refusé.";
        setAuthError(errMsg);
        if (action && onFailedAuth) {
          onFailedAuth(action, errMsg);
        }
      }
    } catch (err: unknown) {
      cyberAudio.playShieldBlock();
      const errMsg = err instanceof Error ? err.message : 'Erreur inattendue WebAuthn';
      setAuthError(errMsg);
      if (action && onFailedAuth) {
        onFailedAuth(action, errMsg);
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Validation par code PIN de secours FIDO2
  const handleVerifyPin = () => {
    const res = verifyFido2PinBackup(pinInput, currentUser);
    if (!res.valid) {
      cyberAudio.playShieldBlock();
      const reason = res.reason || 'Code PIN invalide';
      setPinError(reason);
      if (action && onFailedAuth) {
        onFailedAuth(action, `Code PIN FIDO2 erroné : ${reason}`);
      }
      return;
    }

    cyberAudio.playCryptoBip();
    const challengeBytes = generateWebAuthnChallenge(32);
    const mockAssertion: WebAuthnAssertionResult = {
      success: true,
      credentialId: `fido2-backup-${Date.now()}`,
      clientDataJSON: JSON.stringify({
        type: 'webauthn.get',
        challenge: bufferToHex(challengeBytes),
        origin: window.location.origin
      }),
      authenticatorData: '49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97630100000001',
      signatureHex: '3045022100a7b489c6291b8d60c0f8373b5f92271649989f6687ff02206bb45c43d9ecba70',
      biometricMethod: 'FIDO2_PIN_BACKUP',
      timestampRFC3161: new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC [RFC 3161]',
      rawChallengeHex: bufferToHex(challengeBytes),
      rpId: window.location.hostname
    };

    setAuthSuccess(mockAssertion);
    setTimeout(() => {
      onAuthorized(mockAssertion);
    }, 600);
  };

  // Enregistrement d'une nouvelle clé matérielle WebAuthn (navigator.credentials.create)
  const handleRegisterAuthenticator = async () => {
    setIsRegistering(true);
    setAuthError(null);
    setRegistrationSuccess(null);
    cyberAudio.playTacticalClick();

    if (
      typeof window !== 'undefined' &&
      window.navigator &&
      window.navigator.credentials &&
      typeof window.PublicKeyCredential === 'function'
    ) {
      try {
        const challengeBytes = generateWebAuthnChallenge(32);
        const options = createRegistrationOptions(currentUser, challengeBytes);
        const newCred = await window.navigator.credentials.create(options);
        if (newCred) {
          cyberAudio.playCryptoBip();
          setRegistrationSuccess(`Authentificateur enregistré avec succès : ID ${newCred.id.slice(0, 16)}...`);
        }
      } catch (err: unknown) {
        cyberAudio.playShieldBlock();
        const msg = err instanceof Error ? err.message : String(err);
        setAuthError(`Échec d'enregistrement WebAuthn : ${msg}`);
      } finally {
        setIsRegistering(false);
      }
    } else {
      setIsRegistering(false);
      setAuthError('API WebAuthn non disponible pour l\'enregistrement sur ce client');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-webauthn-title"
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-3 sm:p-6 backdrop-blur-md animate-fadeIn"
    >
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-xl flex flex-col shadow-2xl overflow-hidden relative">
        {/* Lueur supérieure */}
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-32 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />

        {/* En-tête */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-950/80 relative z-10">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-emerald-950/80 border border-emerald-700/80 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
              <Fingerprint className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 id="modal-webauthn-title" className="text-sm sm:text-base font-bold text-white flex items-center space-x-2">
                <span>Autorisation Biométrique Régalienne</span>
                <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded font-mono font-semibold">
                  WEBAUTHN // FIDO2
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                W3C Credential Management API • Validation par plateforme locale
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              cyberAudio.playTacticalClick();
              onClose();
            }}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            title="Annuler l'autorisation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Détails de l'action sensible requérant l'autorisation */}
        <div className="p-4 bg-slate-950/60 border-b border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
              Action Sensible Détectée
            </span>
            <span
              className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                action.severity === 'CRITIQUE'
                  ? 'bg-red-950 text-red-300 border border-red-800'
                  : action.severity === 'TRES_SECRET'
                  ? 'bg-purple-950 text-purple-300 border border-purple-800'
                  : 'bg-amber-950 text-amber-300 border border-amber-800'
              }`}
            >
              {action.severity}
            </span>
          </div>
          <div className="text-sm font-bold text-white">{action.title}</div>
          <div className="text-xs text-slate-300 font-sans leading-relaxed">
            {action.description}
          </div>
          <div className="flex items-center space-x-2 pt-1 text-[11px] font-mono text-slate-400">
            <span>Ressource : <code className="text-cyan-300">{action.targetResource}</code></span>
            <span>•</span>
            <span>Opérateur : <strong className="text-slate-200">{currentUser.matricule}</strong></span>
          </div>
        </div>

        {/* Onglets de sélection du mode d'authentification */}
        <div className="px-4 py-2 border-b border-slate-800 flex items-center space-x-2 bg-slate-950/40 text-xs font-mono">
          <button
            onClick={() => {
              cyberAudio.playTacticalClick();
              setActiveMode('biometric');
            }}
            className={`px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-colors ${
              activeMode === 'biometric'
                ? 'bg-emerald-950 text-emerald-300 font-bold border border-emerald-800 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Scan className="w-3.5 h-3.5" />
            <span>Biométrie ({biometricInfo.label.split('/')[0].trim()})</span>
          </button>
          <button
            onClick={() => {
              cyberAudio.playTacticalClick();
              setActiveMode('pin');
            }}
            className={`px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-colors ${
              activeMode === 'pin'
                ? 'bg-emerald-950 text-emerald-300 font-bold border border-emerald-800 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Code PIN FIDO2 (Secours)</span>
          </button>
          <button
            onClick={() => {
              cyberAudio.playTacticalClick();
              setActiveMode('inspector');
            }}
            className={`px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-colors ${
              activeMode === 'inspector'
                ? 'bg-emerald-950 text-emerald-300 font-bold border border-emerald-800 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Diagnostic Matériel</span>
          </button>
        </div>

        {/* Corps de la modal */}
        <div className="p-5 space-y-4 font-mono text-xs">
          {/* Mode 1 : Biométrie native WebAuthn */}
          {activeMode === 'biometric' && (
            <div className="space-y-5 text-center">
              {/* Radar Biométrique Visuel */}
              <div className="relative w-28 h-28 mx-auto flex items-center justify-center">
                <motion.div
                  animate={{
                    scale: isAuthenticating ? [1, 1.25, 1] : 1,
                    opacity: isAuthenticating ? [0.4, 0.9, 0.4] : 0.6
                  }}
                  transition={{ duration: 1.5, repeat: isAuthenticating ? Infinity : 0 }}
                  className="absolute inset-0 rounded-full bg-emerald-500/10 border border-emerald-500/30"
                />
                <motion.div
                  animate={{
                    rotate: isAuthenticating ? 360 : 0
                  }}
                  transition={{ duration: 3, repeat: isAuthenticating ? Infinity : 0, ease: 'linear' }}
                  className="absolute inset-2 rounded-full border-t-2 border-emerald-400 opacity-60"
                />
                <div className="w-20 h-20 rounded-2xl bg-slate-950 border border-emerald-500/50 flex items-center justify-center text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                  {authSuccess ? (
                    <CheckCircle2 className="w-10 h-10 text-emerald-400 animate-bounce" />
                  ) : (
                    <Fingerprint className={`w-10 h-10 ${isAuthenticating ? 'animate-pulse text-cyan-300' : ''}`} />
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-sm font-bold text-white">
                  {authSuccess
                    ? 'Signature Biométrique Validée !'
                    : isAuthenticating
                    ? 'Détection du capteur biométrique en cours...'
                    : `Autoriser via ${biometricInfo.label}`}
                </div>
                <p className="text-xs text-slate-400 font-sans max-w-md mx-auto">
                  {authSuccess
                    ? 'Le scellé cryptographique W3C WebAuthn a été authentifié avec succès.'
                    : 'Le navigateur va solliciter votre capteur biométrique matériel ou votre clé de sécurité FIDO2.'}
                </p>
              </div>

              {/* Message d'erreur s'il y a lieu */}
              {authError && (
                <div className="p-3 bg-red-950/60 border border-red-800 rounded-xl text-left text-red-200 text-xs font-sans flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold font-mono text-red-300 text-[11px]">Interruption WebAuthn</div>
                    <div>{authError}</div>
                  </div>
                </div>
              )}

              {/* Bouton de déclenchement principal */}
              <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-center">
                <button
                  onClick={handleTriggerBiometric}
                  disabled={isAuthenticating || Boolean(authSuccess)}
                  className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.4)] flex items-center justify-center space-x-2 transition-all"
                >
                  {isAuthenticating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Validation en cours...</span>
                    </>
                  ) : authSuccess ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-white" />
                      <span>Action Autorisée</span>
                    </>
                  ) : (
                    <>
                      <Fingerprint className="w-4 h-4" />
                      <span>Déclencher l'Empreinte / Biométrie</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => setActiveMode('pin')}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors"
                >
                  Utiliser Code PIN FIDO2
                </button>
              </div>
            </div>
          )}

          {/* Mode 2 : Code PIN FIDO2 de secours */}
          {activeMode === 'pin' && (
            <div className="space-y-4">
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-1">
                <div className="text-slate-300 font-bold">Autorisation par Code PIN FIDO2</div>
                <p className="text-slate-400 font-sans text-xs">
                  En l'absence de capteur biométrique opérationnel sur ce poste, saisissez votre code PIN matériel d'agent (ex: <code className="text-emerald-400">4410</code> ou code maître <code className="text-emerald-400">9921</code>).
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] text-slate-400">Code PIN Agent ({currentUser.matricule}) :</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    maxLength={8}
                    value={pinInput}
                    onChange={(e) => {
                      setPinInput(e.target.value);
                      setPinError(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleVerifyPin()}
                    placeholder="••••"
                    className="flex-1 bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-2 text-center text-lg tracking-widest text-emerald-400 font-mono focus:outline-none"
                  />
                  <button
                    onClick={handleVerifyPin}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] shrink-0"
                  >
                    Valider PIN
                  </button>
                </div>
                {pinError && <div className="text-red-400 text-xs font-sans">{pinError}</div>}
              </div>

              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 text-[11px] text-slate-400 font-mono flex items-center justify-between">
                <span>Jeton FIDO2 associé :</span>
                <span className="text-emerald-400 font-bold">{currentUser.fingerprintFIDO}</span>
              </div>
            </div>
          )}

          {/* Mode 3 : Diagnostic matériel & Enregistrement Passkey */}
          {activeMode === 'inspector' && (
            <div className="space-y-3">
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 font-bold">État du Sous-Système WebAuthn</span>
                  <span className="text-emerald-400 font-bold">W3C LEVEL 3</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 bg-slate-900 rounded border border-slate-800">
                    <span className="text-slate-500 block">Support PublicKeyCredential :</span>
                    <span className="text-emerald-400 font-bold">
                      {typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' ? 'DISPONIBLE' : 'NON'}
                    </span>
                  </div>
                  <div className="p-2 bg-slate-900 rounded border border-slate-800">
                    <span className="text-slate-500 block">Capteur Plateforme :</span>
                    <span className={`font-bold ${isPlatformAvailable ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {isPlatformAvailable ? 'DÉTECTÉ' : 'ÉMULÉ / USB FIDO2'}
                    </span>
                  </div>
                  <div className="p-2 bg-slate-900 rounded border border-slate-800">
                    <span className="text-slate-500 block">Relying Party ID (RP) :</span>
                    <span className="text-cyan-400 font-bold truncate">
                      {typeof window !== 'undefined' ? window.location.hostname : 'localhost'}
                    </span>
                  </div>
                  <div className="p-2 bg-slate-900 rounded border border-slate-800">
                    <span className="text-slate-500 block">Algorithmes Autorisés :</span>
                    <span className="text-purple-400 font-bold">ES256 (NIST), RS256</span>
                  </div>
                </div>
              </div>

              {/* Enregistrement d'un authentificateur de plateforme */}
              <div className="p-3 bg-slate-950/80 border border-purple-800/60 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-purple-300 font-bold">Enrôlement Matériel FIDO2</span>
                  <button
                    onClick={handleRegisterAuthenticator}
                    disabled={isRegistering}
                    className="px-3 py-1 bg-purple-900/80 hover:bg-purple-800 text-purple-200 border border-purple-700 rounded-lg text-xs font-bold transition-all shadow-[0_0_10px_rgba(147,51,234,0.3)] flex items-center space-x-1"
                  >
                    <Smartphone className="w-3 h-3" />
                    <span>{isRegistering ? 'Enrôlement...' : 'Enrôler Nouveau Jeton'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 font-sans">
                  Génère une paire de clés asymétriques locale via <code className="text-purple-300">navigator.credentials.create()</code> pour lier définitivement votre poste de travail.
                </p>
                {registrationSuccess && (
                  <div className="p-2 bg-emerald-950/80 border border-emerald-800 text-emerald-300 rounded text-[11px]">
                    {registrationSuccess}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Pied de la modal */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between shrink-0 text-slate-500 text-[10px] font-mono">
          <div className="flex items-center space-x-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Signature cryptographique scellée dans l'audit WORM</span>
          </div>
          <button
            onClick={() => {
              cyberAudio.playTacticalClick();
              onClose();
            }}
            className="text-slate-400 hover:text-white underline"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
