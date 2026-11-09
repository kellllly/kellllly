export const SOVEREIGN_SPECS = {
  golang: `package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
)

// Classification documentaire conforme ANIF Gabon
type Classification string

const (
	TresSecret   Classification = "TRES_SECRET"
	Confidentiel Classification = "CONFIDENTIEL_OPERATIONNEL"
	Restreint    Classification = "RESTREINT"
	Public       Classification = "INTERNE"
)

// MessagePayload : Données chiffrées de bout en bout (Zero-Knowledge)
// Le backend ne reçoit JAMAIS le texte en clair des enquêtes financières.
type EncryptedMessage struct {
	ID             string         \`json:"id"\`
	ChannelID      string         \`json:"channel_id"\`
	SenderID       string         \`json:"sender_id"\`
	SenderRole     int            \`json:"sender_role"\`
	CipherPayload  string         \`json:"cipher_payload"\`  // AES-256-GCM chiffré sur le poste client
	EphemeralNonce string         \`json:"ephemeral_nonce"\` // Vecteur d'initialisation IV
	Classification Classification \`json:"classification"\`
	TimestampRFC   string         \`json:"timestamp_rfc"\`
	MerkleHash     string         \`json:"merkle_hash"\`
}

type SovereignServer struct {
	natsConn   *nats.Conn
	jetStream  nats.JetStreamContext
	auditMutex sync.Mutex
	lastHash   string
}

func NewSovereignServer(natsURL string) (*SovereignServer, error) {
	nc, err := nats.Connect(natsURL)
	if err != nil {
		return nil, fmt.Errorf("échec de connexion NATS au cluster Nkok: %w", err)
	}

	js, err := nc.JetStream()
	if err != nil {
		return nil, fmt.Errorf("échec initialisation JetStream Raft: %w", err)
	}

	// Création du flux durable haute disponibilité
	_, err = js.AddStream(&nats.StreamConfig{
		Name:      "ANIF_SECURE_STREAM",
		Subjects:  []string{"anif.chat.*", "anif.itsm.*", "anif.audit.*"},
		Storage:   nats.FileStorage,
		Replicas:  3, // Déploiement multi-nœuds souverain Tier III
		Retention: nats.LimitsPolicy,
	})
	if err != nil {
		log.Printf("Information flux : %v", err)
	}

	return &SovereignServer{
		natsConn:  nc,
		jetStream: js,
		lastHash:  "0000000000000000000000000000000000000000000000000000000000000000",
	}, nil
}

func (s *SovereignServer) HandleRelayMessage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Méthode interdite", http.StatusMethodNotAllowed)
		return
	}

	var msg EncryptedMessage
	if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
		http.Error(w, "Payload malformé", http.StatusBadRequest)
		return
	}

	msg.TimestampRFC = time.Now().UTC().Format(time.RFC3339Nano)

	// Scellement cryptographique par feuille de Merkle
	s.auditMutex.Lock()
	hashData := fmt.Sprintf("%s|%s|%s|%s|%s", msg.ID, msg.ChannelID, msg.CipherPayload, msg.TimestampRFC, s.lastHash)
	sum := sha256.Sum256([]byte(hashData))
	msg.MerkleHash = hex.EncodeToString(sum[:])
	s.lastHash = msg.MerkleHash
	s.auditMutex.Unlock()

	data, _ := json.Marshal(msg)
	subject := fmt.Sprintf("anif.chat.%s", msg.ChannelID)
	_, err := s.jetStream.Publish(subject, data)
	if err != nil {
		http.Error(w, "Échec persistance distribuée", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{
		"status":      "ROUTED_ZERO_KNOWLEDGE",
		"merkle_leaf": msg.MerkleHash,
	})
}

func main() {
	natsURL := os.Getenv("NATS_URL")
	if natsURL == "" {
		natsURL = "nats://127.0.0.1:4222"
	}

	server, err := NewSovereignServer(natsURL)
	if err != nil {
		log.Fatalf("Arrêt critique - Impossible d'initialiser le cluster ANIF: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/relay", server.HandleRelayMessage)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("TIER-III_NKOK_NODE_HEALTHY_RPO_ZERO"))
	})

	srv := &http.Server{
		Addr:         ":8443",
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	log.Printf("[ANIF BACKEND] Cluster opérationnel sur le nœud souverain de Nkok (:8443)")
	srv.ListenAndServe()
}`,

  postgres: `-- ============================================================================
-- SCRIPT DE DÉPLOIEMENT DE LA BASE DE DONNÉES SOUVERAINE ANIF GABON
-- Localisation physique : Data Center National Tier III de Nkok
-- Réplication synchrone multi-zones : Nkok (Principal) <-> Libreville (Secours)
-- Objectif : RPO = 0 / RTO < 15 min / Conformité Reco 29 GAFI
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE role_accreditation AS ENUM (
    'NIV1_DIRECTION',      -- DG, Magistrat délégué (Très Secret)
    'NIV2_ANALYSTE',       -- Analystes financiers, Enquêteurs (Confidentiel)
    'NIV3_ADMIN_SSI',      -- Support technique, Admin Système (Accès Zéro-Knowledge)
    'NIV4_APPUI',          -- RH, Logistique, Comptabilité (Restreint)
    'NIV5_AUDITEUR_EXT'    -- Inspecteurs COBAC / GABAC (Temporaire)
);

CREATE TYPE canal_typologie AS ENUM (
    'BILATERAL_E2EE',      -- Chiffré de bout en bout strict
    'ENQUETE_SCELLEE',     -- Traitement dossiers d'enrichissement illicite / blanchiment
    'INSTITUTIONNEL',      -- Canaux administratifs et diffusion générale
    'SUPPORT_TECHNIQUE'    -- Échanges avec le SSI pour dépannage
);

CREATE TYPE priorite_sla AS ENUM (
    'P1_CRITIQUE',         -- MTTA < 15 min, MTTR < 2h (Impact opposition 48h)
    'P2_MAJEURE',          -- MTTA < 30 min, MTTR < 4h
    'P3_NORMALE',          -- MTTA < 2h, MTTR < 8h
    'P4_MINEURE'           -- MTTA < 4h, MTTR < 48h
);

-- Table des Messages Chiffrés (Principe Architectural Zero-Knowledge)
CREATE TABLE messagerie_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canal_id UUID REFERENCES messagerie_canaux(id) ON DELETE CASCADE,
    expediteur_id UUID REFERENCES utilisateurs(id),
    payload_chiffre TEXT NOT NULL,           -- Message chiffré côté terminal client
    vecteur_iv VARCHAR(32) NOT NULL,         -- Nonce cryptographique
    ratchet_public_key TEXT NOT NULL,        -- Clé éphémère de la chaîne Ratchet
    signature_ed25519 TEXT NOT NULL,        -- Garantie de non-répudiation
    ephemere_expiration TIMESTAMP WITH TIME ZONE,
    cree_le TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table d'Audit Immuable WORM (Chaînage d'Arbres de Merkle)
CREATE TABLE audit_worm_ledger (
    index_id BIGSERIAL PRIMARY KEY,
    timestamp_rfc3161 TIMESTAMP WITH TIME ZONE NOT NULL,
    evenement VARCHAR(64) NOT NULL,
    acteur_matricule VARCHAR(32) NOT NULL,
    terminal_empreinte TEXT NOT NULL,
    details_operation JSONB NOT NULL,
    hachage_precedent TEXT NOT NULL,
    hachage_actuel TEXT NOT NULL
);

-- Verrouillage de la table WORM : interdiction formelle des UPDATE et DELETE
CREATE OR REPLACE FUNCTION verrouiller_audit_worm()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'VIOLATION CRITIQUE : Les registres d audit WORM sont mathématiquement immuables.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER declencheur_audit_immuable
BEFORE UPDATE OR DELETE ON audit_worm_ledger
FOR EACH ROW EXECUTE FUNCTION verrouiller_audit_worm();

-- Activation du Row-Level Security (RLS) : Exclusion des admins SSI des enquêtes
ALTER TABLE messagerie_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY politique_isolation_zero_knowledge ON messagerie_messages
FOR SELECT
USING (
    CURRENT_SETTING('anif.current_user_role', true) != 'NIV3_ADMIN_SSI'
);`,

  kubernetes: `# ============================================================================
# CLUSTER BARE-METAL KUBERNETES - DATA CENTER DE NKOK (TIER III)
# Micro-cloisonnement réseau étanche et profil de sécurité renforcé
# ============================================================================

apiVersion: v1
kind: Namespace
metadata:
  name: anif-core
  labels:
    pod-security.kubernetes.io/enforce: restricted
    istio-injection: enabled

---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: isoler-crypto-nodes
  namespace: anif-core
spec:
  podSelector:
    matchLabels:
      app: anif-crypto-engine
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: anif-secure-chat
    ports:
    - protocol: TCP
      port: 9443

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: anif-backend-engine
  namespace: anif-core
  labels:
    app: anif-backend
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: anif-backend
  template:
    metadata:
      labels:
        app: anif-backend
    spec:
      containers:
      - name: core-api
        image: registry.anif.ga/sec/backend-core:2026.1
        securityContext:
          readOnlyRootFilesystem: true
          allowPrivilegeEscalation: false
          runAsNonRoot: true
          runAsUser: 10001
          capabilities:
            drop:
            - ALL
        resources:
          limits:
            cpu: "2"
            memory: "2Gi"
          requests:
            cpu: "500m"
            memory: "512Mi"
        env:
        - name: NATS_URL
          value: "nats://nats-cluster.anif-core.svc.cluster.local:4222"
        ports:
        - containerPort: 8443
          name: https
        readinessProbe:
          httpGet:
            path: /healthz
            port: 8443
          initialDelaySeconds: 5
          periodSeconds: 3`
};
