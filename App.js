import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Image,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useAudioPlayer } from 'expo-audio';
import { auth, connexion, db } from './firebase';

// ---------- Images ----------
const IMG_FOND = require('./fond.png'); // fond d'écran : remplacer ce fichier pour changer de fond
const IMG_LOGO = require('./logo.png'); // le cochon bleu
const IMG_CARTE = require('./carte.png'); // carte du solde bleu métallisé
const SON_PIECES = require('./pieces.mp3'); // pièces qui tombent dans la tirelire

// ---------- Couleurs ----------
const BLEU = '#1e4f96';
const BLEU_FONCE = '#0f2f5f';
const BLEU_PALE = '#e6eef8';
const BLEU_TEXTE_CLAIR = '#cfe0f7';
const VERT = '#2e7d32';
const VERT_CLAIR = '#e8f5e9';
const ROUGE = '#d32f2f';
const ROUGE_CLAIR = '#ffebee';
const TEXTE = '#0f1f33';
const GRIS = '#64748b';
const BORDURE = '#e2e8f0';
const PLACEHOLDER = '#c4c8cf'; // gris très clair des textes d'exemple dans les champs

// ---------- Mémoire du téléphone ----------
const CLE_CODES = 'tirelire:codes'; // tirelires suivies sur ce téléphone : [{ id, lecture }]
const CLE_CODE_ANCIEN = 'tirelire:code'; // toute première version : une seule tirelire
const CLE_PRENOM = 'tirelire:prenom';

// ---------- Outils ----------
const LETTRES = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans O/0 ni I/1 pour éviter les confusions

function genererCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += LETTRES[Math.floor(Math.random() * LETTRES.length)];
  }
  return code;
}

// "12,50" -> 1250 centimes. Renvoie null si le montant n'est pas valide.
function enCentimes(texte) {
  const propre = String(texte).replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(propre)) return null;
  const centimes = Math.round(parseFloat(propre) * 100);
  return centimes > 0 ? centimes : null;
}

// 125050 -> "1 250,50 €"
function formatEuros(centimes) {
  const negatif = centimes < 0;
  const absolu = Math.abs(centimes);
  const euros = Math.floor(absolu / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const cts = String(absolu % 100).padStart(2, '0');
  return `${negatif ? '-' : ''}${euros},${cts} €`;
}

function formatJour(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function memeJour(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDate(date) {
  if (!date) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${formatJour(date)} à ${p(date.getHours())}h${p(date.getMinutes())}`;
}

function messageErreur(e) {
  if (e && e.code === 'permission-denied') {
    return "Firebase refuse l'accès. Vérifie les règles de ta base Firestore.";
  }
  if (e && e.code === 'unavailable') {
    return 'Impossible de joindre le serveur. Vérifie ta connexion internet.';
  }
  return (e && e.message) || 'Une erreur inconnue est survenue.';
}

// ---------- Accès sécurisé aux tirelires ----------
// Organisation dans Firebase :
// - tirelires/{id}                 : nom, objectif… (id interne, jamais montré)
// - tirelires/{id}/operations/…    : ajouts et retraits
// - tirelires/{id}/membres/{uid}   : les téléphones autorisés, rôle "parent" ou "lecture"
// - tirelires/{id}/prive/codes     : les codes à partager (visibles des parents seulement)
// - invitations/{code}             : un code à 6 caractères -> { tirelire, role }

function uidActuel() {
  return auth.currentUser ? auth.currentUser.uid : null;
}

// Crée un code d'invitation inédit pour une tirelire.
async function nouvelleInvitation(idTirelire, role) {
  let c = genererCode();
  while ((await getDoc(doc(db, 'invitations', c))).exists()) c = genererCode();
  await setDoc(doc(db, 'invitations', c), { tirelire: idTirelire, role });
  return c;
}

async function invitationSiAbsente(code, idTirelire, role) {
  if (!(await getDoc(doc(db, 'invitations', code))).exists()) {
    await setDoc(doc(db, 'invitations', code), { tirelire: idTirelire, role });
  }
}

// Tirelire créée avant la sécurisation : son code d'origine devient une invitation "parent",
// et son éventuel code enfant une invitation "lecture". Les codes déjà partagés restent valables.
async function migrerAncienne(id) {
  const ref = doc(db, 'tirelires', id);
  const snap = await getDoc(ref);
  if (!snap.exists() || snap.data().v) return;
  const ancien = snap.data();
  await invitationSiAbsente(id, id, 'parent');
  if (ancien.codeLecture) await invitationSiAbsente(ancien.codeLecture, id, 'lecture');
  await setDoc(doc(db, 'tirelires', id, 'prive', 'codes'), {
    parent: id,
    enfant: ancien.codeLecture || null,
  });
  await updateDoc(ref, { v: 2, codeLecture: deleteField() });
}

// Vérifie que ce téléphone a bien accès à une tirelire déjà suivie (et répare si possible).
// Renvoie le rôle : "parent" ou "lecture". Lance une erreur si l'accès est impossible.
async function assurerAcces(id, lecture, prenom) {
  const refMembre = doc(db, 'tirelires', id, 'membres', uidActuel());
  let membre = await getDoc(refMembre);
  if (!membre.exists()) {
    if (lecture) throw new Error('acces');
    const invitation = await getDoc(doc(db, 'invitations', id));
    if (invitation.exists() && invitation.data().tirelire === id) {
      await setDoc(refMembre, {
        role: invitation.data().role,
        invitation: id,
        prenom,
        depuis: serverTimestamp(),
      });
    } else {
      // Ancienne tirelire : connaître son code d'origine suffit.
      await setDoc(refMembre, { role: 'parent', prenom, depuis: serverTimestamp() });
    }
    membre = await getDoc(refMembre);
  }
  const role = membre.data().role;
  if (role === 'parent') await migrerAncienne(id);
  return role;
}

// Efface définitivement une tirelire et tout ce qui la concerne.
async function supprimerTirelireDefinitivement(id, codes) {
  const operations = await getDocs(collection(db, 'tirelires', id, 'operations'));
  await Promise.all(operations.docs.map((d) => deleteDoc(d.ref)));
  if (codes) {
    for (const c of [codes.parent, codes.enfant]) {
      if (c) await deleteDoc(doc(db, 'invitations', c)).catch(() => {});
    }
  }
  await deleteDoc(doc(db, 'tirelires', id, 'prive', 'codes')).catch(() => {});
  const membres = await getDocs(collection(db, 'tirelires', id, 'membres'));
  await Promise.all(
    membres.docs.filter((d) => d.id !== uidActuel()).map((d) => deleteDoc(d.ref))
  );
  await deleteDoc(doc(db, 'tirelires', id));
  await deleteDoc(doc(db, 'tirelires', id, 'membres', uidActuel()));
}

// Hauteur du clavier virtuel (0 quand il est fermé).
// Sur les Android récents, l'écran ne se réduit plus tout seul quand le clavier s'ouvre :
// on mesure donc le clavier pour laisser la place nécessaire en bas.
function useHauteurClavier(auAffichage) {
  const [hauteur, setHauteur] = useState(0);
  useEffect(() => {
    const ouvert = Keyboard.addListener('keyboardDidShow', (e) => {
      setHauteur(e.endCoordinates.height);
      if (auAffichage) setTimeout(auAffichage, 50);
    });
    const ferme = Keyboard.addListener('keyboardDidHide', () => setHauteur(0));
    return () => {
      ouvert.remove();
      ferme.remove();
    };
  }, [auAffichage]);
  return hauteur;
}

// Bouton "retour" d'Android
function useRetourAndroid(action) {
  useEffect(() => {
    if (!action) return undefined;
    const abonnement = BackHandler.addEventListener('hardwareBackPress', () => {
      action();
      return true;
    });
    return () => abonnement.remove();
  }, [action]);
}

// ---------- Application ----------
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Racine />
    </SafeAreaProvider>
  );
}

// Fond d'écran commun à tous les écrans
function Ecran({ children, centre }) {
  return (
    <ImageBackground source={IMG_FOND} style={styles.fond} resizeMode="cover">
      <SafeAreaView style={[styles.ecran, centre && styles.centre]}>{children}</SafeAreaView>
    </ImageBackground>
  );
}

function Chargement() {
  return (
    <Ecran centre>
      <ActivityIndicator size="large" color={BLEU} />
    </Ecran>
  );
}

// Les versions précédentes rangeaient { code } ou seulement le code.
function normaliserEntree(t) {
  if (typeof t === 'string') return { id: t, lecture: false };
  return { id: t.id || t.code, lecture: !!t.lecture };
}

function Racine() {
  const [etat, setEtat] = useState('chargement'); // 'chargement', 'pret' ou 'erreur'
  const [erreurDemarrage, setErreurDemarrage] = useState('');
  const [essai, setEssai] = useState(0);
  const [tirelires, setTirelires] = useState([]); // [{ id, lecture }] : une par enfant, par exemple
  const [ouverte, setOuverte] = useState(null); // id de la tirelire affichée, ou null pour la liste
  const [ajout, setAjout] = useState(false); // écran "ajouter une tirelire"
  const [prenom, setPrenom] = useState('');

  useEffect(() => {
    let annule = false;
    (async () => {
      setEtat('chargement');
      try {
        await connexion();
        const [liste, ancien, p] = await Promise.all([
          AsyncStorage.getItem(CLE_CODES),
          AsyncStorage.getItem(CLE_CODE_ANCIEN),
          AsyncStorage.getItem(CLE_PRENOM),
        ]);
        let entrees = [];
        if (liste) entrees = JSON.parse(liste).map(normaliserEntree);
        else if (ancien) entrees = [{ id: ancien, lecture: false }];

        // Chaque tirelire suivie doit reconnaître ce téléphone (reprise des anciennes versions).
        for (const t of entrees) {
          try {
            t.lecture = (await assurerAcces(t.id, t.lecture, p || '')) === 'lecture';
          } catch (e) {
            // Accès impossible : la tirelire s'affichera comme "inaccessible".
          }
        }
        await AsyncStorage.setItem(CLE_CODES, JSON.stringify(entrees));
        if (!annule) {
          setTirelires(entrees);
          if (p) setPrenom(p);
          setEtat('pret');
        }
      } catch (e) {
        if (!annule) {
          setErreurDemarrage(
            e && e.code === 'auth/admin-restricted-operation'
              ? 'La connexion anonyme n\'est pas activée dans Firebase (Authentication > Sign-in method > Anonyme).'
              : messageErreur(e)
          );
          setEtat('erreur');
        }
      }
    })();
    return () => {
      annule = true;
    };
  }, [essai]);

  async function enregistrer(liste) {
    setTirelires(liste);
    try {
      await AsyncStorage.setItem(CLE_CODES, JSON.stringify(liste));
    } catch (e) {}
  }

  async function entrer(id, nouveauPrenom, lecture) {
    const existante = tirelires.find((t) => t.id === id);
    if (!existante) {
      await enregistrer([...tirelires, { id, lecture }]);
    } else if (existante.lecture !== lecture) {
      await enregistrer(tirelires.map((t) => (t.id === id ? { id, lecture } : t)));
    }
    try {
      await AsyncStorage.setItem(CLE_PRENOM, nouveauPrenom);
    } catch (e) {}
    setPrenom(nouveauPrenom);
    setAjout(false);
    setOuverte(id);
  }

  function retirer(id) {
    enregistrer(tirelires.filter((t) => t.id !== id));
    setOuverte(null);
  }

  const revenirListe = useCallback(() => setOuverte(null), []);
  const fermerAjout = useCallback(() => setAjout(false), []);

  if (etat === 'chargement') return <Chargement />;

  if (etat === 'erreur') {
    return (
      <Ecran centre>
        <Image source={IMG_LOGO} style={styles.logoAccueil} />
        <Text style={styles.erreur}>{erreurDemarrage}</Text>
        <Bouton titre="Réessayer" onPress={() => setEssai((n) => n + 1)} couleur={BLEU} />
      </Ecran>
    );
  }

  if (ouverte) {
    const t = tirelires.find((x) => x.id === ouverte);
    return (
      <Tirelire
        code={ouverte}
        prenom={prenom}
        lectureSeule={t ? t.lecture : false}
        onRetour={revenirListe}
        onQuitter={() => retirer(ouverte)}
      />
    );
  }
  if (ajout || tirelires.length === 0) {
    return (
      <Accueil
        prenomInitial={prenom}
        onEntrer={entrer}
        onRetour={tirelires.length > 0 ? fermerAjout : null}
      />
    );
  }
  return (
    <ListeTirelires tirelires={tirelires} onOuvrir={setOuverte} onAjouter={() => setAjout(true)} />
  );
}

// ---------- En-tête avec le cochon ----------
function EnTete({ titre, sousTitre, onSousTitre, onRetour, droite }) {
  return (
    <View style={styles.entete}>
      {onRetour && (
        <Pressable onPress={onRetour} hitSlop={12} style={styles.boutonRetour}>
          <Text style={styles.texteRetour}>‹</Text>
        </Pressable>
      )}
      <Image source={IMG_LOGO} style={styles.logoEntete} />
      <View style={{ flex: 1 }}>
        <Text style={styles.titreEntete} numberOfLines={1}>
          {titre}
        </Text>
        {sousTitre ? (
          <Pressable onPress={onSousTitre} disabled={!onSousTitre} hitSlop={8}>
            <Text style={styles.sousTitreEntete} numberOfLines={1}>
              {sousTitre}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {droite}
    </View>
  );
}

// ---------- Carte bleu métallisé (ou rouge en cas d'avance) ----------
function CarteSolde({ rouge, children }) {
  if (rouge) {
    return <View style={[styles.carteSolde, { backgroundColor: ROUGE }]}>{children}</View>;
  }
  return (
    <ImageBackground
      source={IMG_CARTE}
      style={styles.carteSolde}
      imageStyle={{ borderRadius: 24 }}
      resizeMode="cover"
    >
      {children}
    </ImageBackground>
  );
}

// ---------- Écran "Mes tirelires" ----------
function ListeTirelires({ tirelires, onOuvrir, onAjouter }) {
  const [soldes, setSoldes] = useState({});
  const majSolde = useCallback(
    (code, solde) =>
      setSoldes((avant) => (avant[code] === solde ? avant : { ...avant, [code]: solde })),
    []
  );
  const total = tirelires.reduce((t, x) => t + (soldes[x.id] || 0), 0);

  return (
    <Ecran>
      <EnTete titre="Mes tirelires" />
      <FlatList
        data={tirelires}
        keyExtractor={(t) => t.id}
        ListHeaderComponent={
          tirelires.length > 1 ? (
            <CarteSolde rouge={total < 0}>
              <Text style={[styles.etiquetteSolde, total < 0 && { color: '#ffcdd2' }]}>
                Total de toutes les tirelires
              </Text>
              <Text style={styles.solde}>{formatEuros(total)}</Text>
            </CarteSolde>
          ) : null
        }
        renderItem={({ item }) => (
          <CarteTirelire
            code={item.id}
            lecture={item.lecture}
            onOuvrir={() => onOuvrir(item.id)}
            onSolde={majSolde}
          />
        )}
        ListFooterComponent={
          <Bouton
            titre="+ Ajouter une tirelire"
            onPress={onAjouter}
            couleur={BLEU}
            style={{ marginTop: 6 }}
          />
        }
        contentContainerStyle={styles.liste}
      />
    </Ecran>
  );
}

function CarteTirelire({ code, lecture, onOuvrir, onSolde }) {
  const [infos, setInfos] = useState(null);
  const [solde, setSolde] = useState(null);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    const refTirelire = doc(db, 'tirelires', code);
    const arreterInfos = onSnapshot(
      refTirelire,
      (snap) => (snap.exists() ? setInfos(snap.data()) : setErreur(true)),
      () => setErreur(true)
    );
    const arreterOperations = onSnapshot(
      collection(refTirelire, 'operations'),
      (snap) => {
        let t = 0;
        snap.forEach((d) => {
          t += d.data().montant || 0;
        });
        setSolde(t);
      },
      () => setErreur(true)
    );
    return () => {
      arreterInfos();
      arreterOperations();
    };
  }, [code]);

  useEffect(() => {
    if (solde !== null) onSolde(code, solde);
  }, [code, solde, onSolde]);

  const objectif = infos && infos.objectif ? infos.objectif : 0;
  const progression =
    objectif > 0 && solde !== null ? Math.max(0, Math.min(1, solde / objectif)) : 0;
  const avance = solde !== null && solde < 0;

  let sousTitre;
  if (erreur) sousTitre = 'Introuvable ou inaccessible';
  else if (avance) sousTitre = 'Avance à rembourser';
  else if (objectif > 0)
    sousTitre = `${infos.objectifNom || 'Objectif'} ${formatEuros(objectif)} · ${Math.floor(
      progression * 100
    )} %`;
  else sousTitre = lecture ? 'Lecture seule' : "Pas d'objectif pour l'instant";

  return (
    <Pressable
      onPress={onOuvrir}
      style={({ pressed }) => [styles.carteListe, pressed && { opacity: 0.75 }]}
    >
      <View style={{ flex: 1 }}>
        <View style={styles.rangeeTitre}>
          <Text style={styles.ligneTitre} numberOfLines={1}>
            {erreur ? 'Tirelire inaccessible' : infos ? infos.nom : '…'}
          </Text>
          {lecture && <Text style={styles.badge}>👀</Text>}
        </View>
        <Text style={styles.ligneSous} numberOfLines={1}>
          {sousTitre}
        </Text>
        {objectif > 0 && !erreur && !avance && (
          <View style={styles.barreListe}>
            <View style={[styles.barreListeRemplie, { width: `${progression * 100}%` }]} />
          </View>
        )}
      </View>
      <Text style={[styles.soldeListe, avance && { color: ROUGE }]}>
        {solde === null ? '' : formatEuros(solde)}
      </Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

// ---------- Écran pour créer ou rejoindre une tirelire ----------
function Accueil({ prenomInitial, onEntrer, onRetour }) {
  const [prenom, setPrenom] = useState(prenomInitial || '');
  const [nom, setNom] = useState('');
  const [codeSaisi, setCodeSaisi] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [mode, setMode] = useState(null); // null = choix, 'creer' ou 'code'
  const revenirChoix = useCallback(() => setMode(null), []);
  const defilement = useRef(null);
  // Quand le clavier s'ouvre, on fait défiler pour garder le champ et le bouton visibles.
  const montrerBas = useCallback(() => {
    if (defilement.current) defilement.current.scrollToEnd({ animated: true });
  }, []);
  const hauteurClavier = useHauteurClavier(montrerBas);

  useRetourAndroid(mode ? revenirChoix : onRetour);

  function prenomValide() {
    const p = prenom.trim();
    if (!p) {
      Alert.alert(
        'Ton prénom',
        "Indique ton prénom pour que tout le monde sache qui a ajouté ou retiré de l'argent."
      );
      return null;
    }
    return p;
  }

  async function creer() {
    const p = prenomValide();
    if (!p) return;
    setOccupe(true);
    try {
      const uid = uidActuel();
      const ref = doc(collection(db, 'tirelires')); // identifiant interne, long et secret
      await setDoc(ref, {
        nom: nom.trim() || 'Ma tirelire',
        objectif: null,
        objectifNom: '',
        creePar: p,
        proprietaire: uid,
        creeLe: serverTimestamp(),
        v: 2,
      });
      await setDoc(doc(db, 'tirelires', ref.id, 'membres', uid), {
        role: 'parent',
        prenom: p,
        depuis: serverTimestamp(),
      });
      const codeParent = await nouvelleInvitation(ref.id, 'parent');
      await setDoc(doc(db, 'tirelires', ref.id, 'prive', 'codes'), {
        parent: codeParent,
        enfant: null,
      });
      await onEntrer(ref.id, p, false);
    } catch (e) {
      Alert.alert('Erreur', messageErreur(e));
      setOccupe(false);
    }
  }

  async function rejoindre() {
    const p = prenomValide();
    if (!p) return;
    const c = codeSaisi.trim().toUpperCase();
    if (c.length !== 6) {
      Alert.alert('Code', "Le code d'une tirelire fait 6 caractères.");
      return;
    }
    setOccupe(true);
    try {
      const uid = uidActuel();
      const invitation = await getDoc(doc(db, 'invitations', c));
      if (invitation.exists()) {
        const { tirelire, role } = invitation.data();
        const refMembre = doc(db, 'tirelires', tirelire, 'membres', uid);
        const deja = await getDoc(refMembre);
        // Un parent qui entre un code enfant garde ses droits de parent.
        const garderParent = deja.exists() && deja.data().role === 'parent';
        if (!garderParent) {
          await setDoc(refMembre, { role, invitation: c, prenom: p, depuis: serverTimestamp() });
        }
        await onEntrer(tirelire, p, !garderParent && role === 'lecture');
        return;
      }
      // Ancienne tirelire pas encore mise à jour par son créateur : son code d'origine suffit.
      try {
        await setDoc(doc(db, 'tirelires', c, 'membres', uid), {
          role: 'parent',
          prenom: p,
          depuis: serverTimestamp(),
        });
      } catch (e) {
        Alert.alert('Introuvable', 'Aucune tirelire ne porte ce code. Vérifie-le.');
        setOccupe(false);
        return;
      }
      await migrerAncienne(c);
      await onEntrer(c, p, false);
    } catch (e) {
      Alert.alert('Erreur', messageErreur(e));
      setOccupe(false);
    }
  }

  const champPrenom = (
    <>
      <Text style={styles.etiquette}>Ton prénom</Text>
      <TextInput
        placeholderTextColor={PLACEHOLDER}
        style={styles.champ}
        placeholder="Par exemple : Léa"
        value={prenom}
        onChangeText={setPrenom}
        maxLength={30}
      />
    </>
  );

  return (
    <Ecran>
      <View style={{ flex: 1 }}>
        <ScrollView
          ref={defilement}
          contentContainerStyle={[styles.accueil, { paddingBottom: 24 + hauteurClavier }]}
          keyboardShouldPersistTaps="handled"
        >
          {mode ? (
            <Pressable onPress={() => setMode(null)} hitSlop={10} style={{ alignSelf: 'flex-start' }}>
              <Text style={styles.lienRetour}>‹ Retour</Text>
            </Pressable>
          ) : onRetour ? (
            <Pressable onPress={onRetour} hitSlop={10} style={{ alignSelf: 'flex-start' }}>
              <Text style={styles.lienRetour}>‹ Mes tirelires</Text>
            </Pressable>
          ) : null}
          <Image source={IMG_LOGO} style={styles.logoAccueil} />
          <Text style={styles.titreAccueil}>Tirelire</Text>
          <Text style={styles.sousTitre}>L'argent de poche de toute la famille</Text>

          {/* 1. On choisit d'abord ce qu'on veut faire */}
          {!mode && (
            <>
              <Pressable
                onPress={() => setMode('creer')}
                style={({ pressed }) => [styles.choix, pressed && { opacity: 0.8 }]}
              >
                <Text style={styles.choixIcone}>🐷</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.choixTitre}>Créer une tirelire</Text>
                  <Text style={styles.choixTexte}>
                    Pour gérer l'argent de poche de vos enfants.
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
              <Pressable
                onPress={() => setMode('code')}
                style={({ pressed }) => [styles.choix, pressed && { opacity: 0.8 }]}
              >
                <Text style={styles.choixIcone}>🔑</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.choixTitre}>J'ai un code</Text>
                  <Text style={styles.choixTexte}>
                    Reçu d'un parent, pour voir ou gérer une tirelire.
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            </>
          )}

          {/* 2a. Créer */}
          {mode === 'creer' && (
            <View style={styles.carte}>
              <Text style={styles.titreCarte}>Créer une tirelire</Text>
              {champPrenom}
              <Text style={styles.etiquette}>Nom de la tirelire</Text>
              <TextInput
                placeholderTextColor={PLACEHOLDER}
                style={styles.champ}
                placeholder="Prénom de l'enfant, Vacances…"
                value={nom}
                onChangeText={setNom}
                maxLength={40}
              />
              <Bouton titre="Créer la tirelire" onPress={creer} desactive={occupe} couleur={BLEU} />
            </View>
          )}

          {/* 2b. Entrer un code */}
          {mode === 'code' && (
            <View style={styles.carte}>
              <Text style={styles.titreCarte}>Entrer mon code</Text>
              {champPrenom}
              <Text style={styles.etiquette}>Code à 6 caractères</Text>
              <TextInput
                placeholderTextColor={PLACEHOLDER}
                style={[styles.champ, styles.champCode]}
                placeholder="CODE"
                value={codeSaisi}
                onChangeText={(t) => setCodeSaisi(t.toUpperCase())}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={6}
              />
              <Bouton titre="Valider le code" onPress={rejoindre} desactive={occupe} couleur={BLEU} />
            </View>
          )}

          {occupe && <ActivityIndicator style={{ marginTop: 16 }} color={BLEU} />}
        </ScrollView>
      </View>
    </Ecran>
  );
}

// ---------- Écran d'une tirelire ----------
function Tirelire({ code, prenom, lectureSeule, onRetour, onQuitter }) {
  const [infos, setInfos] = useState(null);
  const [operations, setOperations] = useState([]);
  const [erreur, setErreur] = useState(null);
  const [saisie, setSaisie] = useState(null); // 'ajout', 'retrait' ou null
  const [edition, setEdition] = useState(null); // opération en cours de modification
  const [reglages, setReglages] = useState(false);
  const [codes, setCodes] = useState(null); // codes à partager (parents seulement)
  const [suppression, setSuppression] = useState(false);
  const sonPieces = useAudioPlayer(SON_PIECES);

  function jouerPieces() {
    try {
      sonPieces.seekTo(0);
      sonPieces.play();
    } catch (e) {
      // Pas de son : ce n'est pas grave.
    }
  }

  useRetourAndroid(onRetour);

  // Les codes à partager ne sont lisibles que par les parents.
  useEffect(() => {
    if (lectureSeule) return undefined;
    return onSnapshot(
      doc(db, 'tirelires', code, 'prive', 'codes'),
      (snap) => setCodes(snap.exists() ? snap.data() : null),
      () => setCodes(null)
    );
  }, [code, lectureSeule]);

  // Écoute en direct : chaque changement fait par n'importe qui apparaît tout de suite.
  useEffect(() => {
    const refTirelire = doc(db, 'tirelires', code);

    const arreterInfos = onSnapshot(
      refTirelire,
      (snap) => {
        if (snap.exists()) {
          setInfos(snap.data());
        } else {
          setErreur("Cette tirelire n'existe plus.");
        }
      },
      (e) =>
        setErreur(
          e && e.code === 'permission-denied'
            ? "Ce téléphone n'a plus accès à cette tirelire. Demande le code à un parent."
            : messageErreur(e)
        )
    );

    const arreterOperations = onSnapshot(
      query(collection(refTirelire, 'operations'), orderBy('date', 'desc')),
      (snap) => {
        setOperations(
          snap.docs.map((d) => {
            const data = d.data({ serverTimestamps: 'estimate' });
            return {
              id: d.id,
              montant: data.montant || 0,
              note: data.note || '',
              auteur: data.auteur || '',
              date: data.date ? data.date.toDate() : null,
            };
          })
        );
      },
      (e) => setErreur(messageErreur(e))
    );

    return () => {
      arreterInfos();
      arreterOperations();
    };
  }, [code]);

  const solde = useMemo(
    () => operations.reduce((total, op) => total + op.montant, 0),
    [operations]
  );

  // date : null = maintenant (heure du serveur), sinon la date choisie dans le calendrier.
  // Renvoie true si la fenêtre peut se fermer tout de suite.
  function enregistrerOperation(type, centimes, note, date, fermer) {
    function ecrire() {
      jouerPieces();
      // Pas de "await" : l'opération s'affiche tout de suite, même avec une connexion lente.
      addDoc(collection(db, 'tirelires', code, 'operations'), {
        montant: type === 'ajout' ? centimes : -centimes,
        note: note.trim(),
        auteur: prenom,
        date: date ? Timestamp.fromDate(date) : serverTimestamp(),
      }).catch((e) => Alert.alert('Erreur', messageErreur(e)));
    }

    // Retrait plus grand que le solde : c'est une avance, le solde devient négatif.
    if (type === 'retrait' && centimes > solde) {
      Alert.alert(
        'Faire une avance ?',
        `Il y a ${formatEuros(solde)} dans la tirelire. Après ce retrait, le solde sera de ${formatEuros(
          solde - centimes
        )} : une avance que l'enfant devra rembourser.`,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Oui, avancer',
            onPress: () => {
              ecrire();
              fermer();
            },
          },
        ]
      );
      return false;
    }

    ecrire();
    return true;
  }

  // Modifie une opération existante (montant, désignation, date).
  function modifierOperation(op, type, centimes, note, date, fermer) {
    const nouveauMontant = type === 'ajout' ? centimes : -centimes;
    function ecrire() {
      const modifs = { montant: nouveauMontant, note: note.trim(), modifiePar: prenom };
      if (date) modifs.date = Timestamp.fromDate(date);
      updateDoc(doc(db, 'tirelires', code, 'operations', op.id), modifs).catch((e) =>
        Alert.alert('Erreur', messageErreur(e))
      );
    }

    const soldeApres = solde - op.montant + nouveauMontant;
    if (soldeApres < 0 && soldeApres < solde) {
      Alert.alert(
        'Faire une avance ?',
        `Après cette modification, le solde sera de ${formatEuros(
          soldeApres
        )} : une avance que l'enfant devra rembourser.`,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Oui, avancer',
            onPress: () => {
              ecrire();
              fermer();
            },
          },
        ]
      );
      return false;
    }

    ecrire();
    return true;
  }

  function supprimerOperation(op) {
    Alert.alert(
      'Supprimer cette opération ?',
      `${op.montant >= 0 ? '+' : ''}${formatEuros(op.montant)}${op.note ? ` · ${op.note}` : ''}`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () =>
            deleteDoc(doc(db, 'tirelires', code, 'operations', op.id)).catch((e) =>
              Alert.alert('Erreur', messageErreur(e))
            ),
        },
      ]
    );
  }

  function enregistrerReglages(modifs) {
    updateDoc(doc(db, 'tirelires', code), modifs).catch((e) =>
      Alert.alert('Erreur', messageErreur(e))
    );
  }

  // Code "enfant" en lecture seule : créé la première fois qu'on en a besoin.
  async function obtenirCodeEnfant() {
    if (codes && codes.enfant) return codes.enfant;
    const c = await nouvelleInvitation(code, 'lecture');
    await setDoc(doc(db, 'tirelires', code, 'prive', 'codes'), { enfant: c }, { merge: true });
    return c;
  }

  async function partagerEnfant() {
    try {
      const c = await obtenirCodeEnfant();
      await Share.share({
        message: `Voici ta tirelire « ${infos.nom} » ! Installe l'appli Tirelire, choisis « J'ai un code » et entre : ${c}`,
      });
    } catch (e) {
      Alert.alert('Erreur', messageErreur(e));
    }
  }

  async function partagerParent() {
    if (!codes || !codes.parent) {
      Alert.alert('Code', "Le code n'est pas encore disponible, réessaie dans un instant.");
      return;
    }
    try {
      await Share.share({
        message: `Rejoins la tirelire « ${infos.nom} » dans l'appli Tirelire : choisis « J'ai un code » et entre ${codes.parent}`,
      });
    } catch (e) {}
  }

  async function supprimerDefinitivement() {
    setReglages(false);
    setSuppression(true);
    try {
      await supprimerTirelireDefinitivement(code, codes);
      onQuitter();
    } catch (e) {
      setSuppression(false);
      Alert.alert('Erreur', messageErreur(e));
    }
  }

  function partager() {
    Alert.alert('Partager la tirelire', 'Avec qui veux-tu la partager ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Votre enfant (lecture seule)', onPress: partagerEnfant },
      { text: 'Un parent', onPress: partagerParent },
    ]);
  }

  if (suppression) {
    return (
      <Ecran centre>
        <ActivityIndicator size="large" color={ROUGE} />
        <Text style={[styles.aide, { marginTop: 16 }]}>Suppression en cours…</Text>
      </Ecran>
    );
  }

  if (erreur) {
    return (
      <Ecran centre>
        <Text style={styles.erreur}>{erreur}</Text>
        <Bouton
          titre="‹ Mes tirelires"
          onPress={onRetour}
          secondaire
          style={{ alignSelf: 'stretch' }}
        />
        <Pressable onPress={onQuitter} hitSlop={8}>
          <Text style={styles.lienRouge}>Retirer de mes tirelires</Text>
        </Pressable>
      </Ecran>
    );
  }

  if (!infos) return <Chargement />;

  const objectif = infos.objectif || 0;
  const progression = objectif > 0 ? Math.max(0, Math.min(1, solde / objectif)) : 0;
  const avance = solde < 0; // solde négatif = argent avancé à l'enfant
  const texteClair = { color: avance ? '#ffcdd2' : BLEU_TEXTE_CLAIR };

  const enTete = (
    <View>
      <CarteSolde rouge={avance}>
        <Text style={[styles.etiquetteSolde, texteClair]}>
          {avance ? 'Avance à rembourser' : 'Dans la tirelire'}
        </Text>
        <Text style={styles.solde}>{formatEuros(solde)}</Text>

        {objectif > 0 ? (
          <Pressable
            onPress={() => setReglages(true)}
            disabled={lectureSeule}
            style={styles.objectif}
          >
            <Text style={styles.objectifTexte} numberOfLines={1}>
              🎯 {infos.objectifNom ? infos.objectifNom : 'Objectif'} : {formatEuros(objectif)}
            </Text>
            <View style={styles.barre}>
              <View style={[styles.barreRemplie, { width: `${progression * 100}%` }]} />
            </View>
            <Text style={[styles.objectifSous, texteClair]}>
              {solde >= objectif
                ? 'Objectif atteint ! 🎉'
                : `Encore ${formatEuros(objectif - solde)} · ${Math.floor(progression * 100)} %`}
            </Text>
          </Pressable>
        ) : !lectureSeule ? (
          <Pressable onPress={() => setReglages(true)} hitSlop={8}>
            <Text style={styles.lien}>🎯 Fixer un objectif d'épargne</Text>
          </Pressable>
        ) : null}
      </CarteSolde>

      {lectureSeule ? (
        <View style={styles.bandeauLecture}>
          <Text style={styles.texteBandeau}>👀 Lecture seule : seuls les parents peuvent modifier.</Text>
        </View>
      ) : (
        <View style={styles.rangeeBoutons}>
          <Bouton titre="+ Ajouter" onPress={() => setSaisie('ajout')} style={{ flex: 1 }} />
          <Bouton
            titre="− Retirer"
            onPress={() => setSaisie('retrait')}
            style={{ flex: 1 }}
            couleur={ROUGE}
          />
        </View>
      )}

      <Text style={styles.titreSection}>Historique</Text>
    </View>
  );

  return (
    <Ecran>
      <EnTete
        titre={infos.nom}
        sousTitre={
          lectureSeule ? '👀 Lecture seule' : codes && codes.parent ? `Code ${codes.parent} · Partager` : 'Partager'
        }
        onSousTitre={lectureSeule ? null : partager}
        onRetour={onRetour}
        droite={
          <Pressable onPress={() => setReglages(true)} style={styles.boutonReglages} hitSlop={8}>
            <Text style={styles.texteReglages}>Réglages</Text>
          </Pressable>
        }
      />

      <FlatList
        data={operations}
        keyExtractor={(op) => op.id}
        ListHeaderComponent={enTete}
        ListEmptyComponent={
          <Text style={styles.vide}>
            {lectureSeule
              ? "Pas encore d'opération dans cette tirelire."
              : "Aucune opération pour l'instant. Ajoute ta première pièce !"}
          </Text>
        }
        ListFooterComponent={
          operations.length > 0 && !lectureSeule ? (
            <Text style={styles.astuce}>
              Appui long pour supprimer, double-clic pour modifier.
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <LigneOperation
            op={item}
            onSupprimer={lectureSeule ? null : () => supprimerOperation(item)}
            onModifier={lectureSeule ? null : () => setEdition(item)}
          />
        )}
        contentContainerStyle={styles.liste}
      />

      {!lectureSeule && (
        <FenetreMontant
          type={saisie || (edition ? (edition.montant >= 0 ? 'ajout' : 'retrait') : null)}
          operation={edition}
          onFermer={() => {
            setSaisie(null);
            setEdition(null);
          }}
          onValider={(centimes, note, date, fermer) =>
            edition
              ? modifierOperation(
                  edition,
                  edition.montant >= 0 ? 'ajout' : 'retrait',
                  centimes,
                  note,
                  date,
                  fermer
                )
              : enregistrerOperation(saisie, centimes, note, date, fermer)
          }
        />
      )}

      <FenetreReglages
        visible={reglages}
        infos={infos}
        codes={codes}
        prenom={prenom}
        lectureSeule={lectureSeule}
        onFermer={() => setReglages(false)}
        onEnregistrer={enregistrerReglages}
        onSupprimer={supprimerDefinitivement}
        onQuitter={() => {
          setReglages(false);
          onQuitter();
        }}
      />
    </Ecran>
  );
}

// ---------- Une ligne de l'historique ----------
function LigneOperation({ op, onSupprimer, onModifier }) {
  const positif = op.montant >= 0;
  const dernierAppui = useRef(0);

  // Deux appuis rapprochés (moins de 0,35 s) = double-clic.
  function appui() {
    if (!onModifier) return;
    const maintenant = Date.now();
    if (maintenant - dernierAppui.current < 350) {
      dernierAppui.current = 0;
      onModifier();
    } else {
      dernierAppui.current = maintenant;
    }
  }

  return (
    <Pressable
      onPress={appui}
      onLongPress={onSupprimer || undefined}
      style={({ pressed }) => [styles.ligne, pressed && onSupprimer && { opacity: 0.75 }]}
    >
      <View style={[styles.pastille, { backgroundColor: positif ? VERT_CLAIR : ROUGE_CLAIR }]}>
        <Text style={[styles.pastilleTexte, { color: positif ? VERT : ROUGE }]}>
          {positif ? '+' : '−'}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.ligneTitre} numberOfLines={1}>
          {op.note || (positif ? 'Ajout' : 'Retrait')}
        </Text>
        <Text style={styles.ligneSous} numberOfLines={1}>
          {op.auteur}
          {op.date ? ` · ${formatDate(op.date)}` : ''}
        </Text>
      </View>
      <Text style={[styles.ligneMontant, { color: positif ? VERT : ROUGE }]}>
        {positif ? '+' : ''}
        {formatEuros(op.montant)}
      </Text>
    </Pressable>
  );
}

// ---------- Fenêtre pour ajouter / retirer ----------
function FenetreMontant({ type, operation, onFermer, onValider }) {
  const [montant, setMontant] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(new Date());
  const [dateModifiee, setDateModifiee] = useState(false);
  const ajout = type === 'ajout';

  useEffect(() => {
    if (!type) return;
    if (operation) {
      // Modification : on part des valeurs de l'opération.
      const a = Math.abs(operation.montant);
      setMontant(`${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`);
      setNote(operation.note || '');
      setDate(operation.date || new Date());
    } else {
      setMontant('');
      setNote('');
      setDate(new Date());
    }
    setDateModifiee(false);
  }, [type, operation]);

  function choisirDate() {
    DateTimePickerAndroid.open({
      value: date,
      mode: 'date',
      onValueChange: (evenement, choisie) => {
        if (!choisie) return;
        // On garde l'heure déjà prévue pour que les opérations du même jour restent dans l'ordre.
        const nouvelle = new Date(choisie);
        nouvelle.setHours(date.getHours(), date.getMinutes(), date.getSeconds(), 0);
        setDate(nouvelle);
        setDateModifiee(true);
      },
    });
  }

  function valider() {
    const centimes = enCentimes(montant);
    if (!centimes) {
      Alert.alert('Montant', 'Saisis un montant valide, par exemple 5 ou 12,50.');
      return;
    }
    if (onValider(centimes, note, dateModifiee ? date : null, onFermer)) onFermer();
  }

  return (
    <Modal visible={!!type} transparent animationType="slide" onRequestClose={onFermer}>
      <KeyboardAvoidingView
        style={styles.fondModal}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modal}>
          <View style={styles.poignee} />
          <Text style={styles.titreModal}>
            {operation
              ? ajout
                ? 'Modifier cet ajout'
                : 'Modifier ce retrait'
              : ajout
              ? "Ajouter de l'argent"
              : "Retirer de l'argent"}
          </Text>
          <TextInput
            placeholderTextColor={PLACEHOLDER}
            style={[styles.champ, styles.champMontant]}
            placeholder="0,00 €"
            keyboardType="decimal-pad"
            value={montant}
            onChangeText={setMontant}
            autoFocus={!operation}
          />
          <Pressable onPress={choisirDate} style={[styles.champ, styles.champDate]}>
            <Text style={styles.texteDate}>📅  {formatJour(date)}</Text>
            <Text style={styles.indicationDate}>
              {memeJour(date, new Date()) ? "aujourd'hui · changer" : 'changer'}
            </Text>
          </Pressable>
          <TextInput
            placeholderTextColor={PLACEHOLDER}
            style={styles.champ}
            placeholder="Désignation"
            value={note}
            onChangeText={setNote}
            maxLength={60}
          />
          <View style={styles.rangeeBoutons}>
            <Bouton titre="Annuler" secondaire onPress={onFermer} style={{ flex: 1 }} />
            <Bouton
              titre="Valider"
              couleur={ajout ? VERT : ROUGE}
              onPress={valider}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------- Fenêtre des réglages ----------
function FenetreReglages({
  visible,
  infos,
  codes,
  prenom,
  lectureSeule,
  onFermer,
  onEnregistrer,
  onQuitter,
  onSupprimer,
}) {
  const [nom, setNom] = useState('');
  const [objectif, setObjectif] = useState('');
  const [objectifNom, setObjectifNom] = useState('');

  useEffect(() => {
    if (visible && infos) {
      setNom(infos.nom || '');
      setObjectif(infos.objectif ? String(infos.objectif / 100).replace('.', ',') : '');
      setObjectifNom(infos.objectifNom || '');
    }
  }, [visible]);

  function enregistrer() {
    let centimes = null;
    if (objectif.trim()) {
      centimes = enCentimes(objectif);
      if (!centimes) {
        Alert.alert('Objectif', 'Saisis un montant valide, par exemple 200 ou 49,90.');
        return;
      }
    }
    onEnregistrer({
      nom: nom.trim() || 'Ma tirelire',
      objectif: centimes,
      objectifNom: objectifNom.trim(),
    });
    onFermer();
  }

  function confirmerSuppression() {
    Alert.alert(
      'Supprimer définitivement ?',
      `La tirelire « ${infos ? infos.nom : ''} », tout son historique et ses codes seront effacés pour tout le monde. C'est irréversible.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Continuer',
          style: 'destructive',
          onPress: () =>
            Alert.alert('Dernière confirmation', 'Tout effacer maintenant ?', [
              { text: 'Non', style: 'cancel' },
              { text: 'Oui, tout effacer', style: 'destructive', onPress: onSupprimer },
            ]),
        },
      ]
    );
  }

  function confirmerQuitter() {
    Alert.alert(
      'Retirer de mes tirelires ?',
      "Elle disparaît seulement de ce téléphone, elle n'est pas supprimée. Tu pourras la rajouter plus tard avec son code.",
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Retirer', style: 'destructive', onPress: onQuitter },
      ]
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <KeyboardAvoidingView
        style={styles.fondModal}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modal}>
          <View style={styles.poignee} />
          <Text style={styles.titreModal}>Réglages</Text>

          {lectureSeule ? (
            <>
              <Text style={styles.aide}>
                Cette tirelire est en lecture seule sur ce téléphone : seuls les parents peuvent la
                modifier.
              </Text>
              <Bouton titre="Fermer" secondaire onPress={onFermer} />
            </>
          ) : (
            <>
              <Text style={styles.etiquette}>Nom de la tirelire</Text>
              <TextInput
                placeholderTextColor={PLACEHOLDER}
                style={styles.champ}
                value={nom}
                onChangeText={setNom}
                maxLength={40}
              />

              <Text style={styles.etiquette}>Objectif d'épargne (laisser vide pour aucun)</Text>
              <TextInput
                placeholderTextColor={PLACEHOLDER}
                style={styles.champ}
                placeholder="Montant en €"
                keyboardType="decimal-pad"
                value={objectif}
                onChangeText={setObjectif}
              />
              <TextInput
                placeholderTextColor={PLACEHOLDER}
                style={styles.champ}
                placeholder="Pour quoi ? (vélo, vacances…)"
                value={objectifNom}
                onChangeText={setObjectifNom}
                maxLength={40}
              />

              <View style={styles.rangeeBoutons}>
                <Bouton titre="Annuler" secondaire onPress={onFermer} style={{ flex: 1 }} />
                <Bouton titre="Enregistrer" onPress={enregistrer} couleur={BLEU} style={{ flex: 1 }} />
              </View>

              {codes && (
                <Text style={styles.infoPrenom}>
                  Code parent : {codes.parent}
                  {codes.enfant ? `  ·  Code enfant : ${codes.enfant}` : ''}
                </Text>
              )}
            </>
          )}

          <Text style={styles.infoPrenom}>Connecté en tant que {prenom}</Text>
          <Pressable onPress={confirmerQuitter} hitSlop={8}>
            <Text style={styles.lienRouge}>Retirer de mes tirelires</Text>
          </Pressable>
          {!lectureSeule && (
            <Pressable onPress={confirmerSuppression} hitSlop={8}>
              <Text style={styles.lienSupprimer}>Supprimer définitivement cette tirelire</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------- Bouton réutilisable ----------
function Bouton({ titre, onPress, couleur = VERT, secondaire, style, desactive }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={desactive}
      style={({ pressed }) => [
        styles.bouton,
        secondaire ? styles.boutonSecondaire : { backgroundColor: couleur },
        (pressed || desactive) && { opacity: 0.6 },
        style,
      ]}
    >
      <Text style={[styles.texteBouton, secondaire && { color: TEXTE }]}>{titre}</Text>
    </Pressable>
  );
}

// ---------- Styles ----------
const ombre = {
  shadowColor: '#1e3a6b',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.12,
  shadowRadius: 12,
  elevation: 3,
};

const styles = StyleSheet.create({
  fond: { flex: 1 },
  ecran: { flex: 1, backgroundColor: 'transparent' },
  centre: { alignItems: 'center', justifyContent: 'center', padding: 24 },

  // En-tête
  entete: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 10,
  },
  logoEntete: { width: 46, height: 46 },
  titreEntete: { fontSize: 26, fontWeight: '800', color: BLEU_FONCE },
  sousTitreEntete: { fontSize: 14, color: GRIS, marginTop: 1 },
  boutonRetour: { paddingRight: 2 },
  texteRetour: { fontSize: 36, lineHeight: 38, color: BLEU_FONCE, fontWeight: '300' },
  boutonReglages: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  texteReglages: { fontSize: 14, fontWeight: '700', color: BLEU_FONCE },

  // Accueil
  accueil: { padding: 20, paddingTop: 24 },
  lienRetour: { fontSize: 16, color: BLEU, fontWeight: '700', marginBottom: 8 },
  logoAccueil: { width: 130, height: 130, alignSelf: 'center' },
  titreAccueil: {
    fontSize: 34,
    fontWeight: '800',
    color: BLEU_FONCE,
    textAlign: 'center',
    marginTop: 4,
  },
  sousTitre: { fontSize: 16, color: GRIS, textAlign: 'center', marginBottom: 20 },
  carte: {
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 18,
    marginBottom: 12,
    ...ombre,
  },
  titreCarte: { fontSize: 18, fontWeight: '800', color: TEXTE, marginBottom: 10 },
  etiquette: { fontSize: 14, fontWeight: '700', color: TEXTE, marginBottom: 6 },
  aide: { fontSize: 14, color: GRIS, marginBottom: 12, lineHeight: 20 },
  choix: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 20,
    marginBottom: 14,
    gap: 14,
    ...ombre,
  },
  choixIcone: { fontSize: 34 },
  choixTitre: { fontSize: 18, fontWeight: '800', color: BLEU_FONCE },
  choixTexte: { fontSize: 14, color: GRIS, marginTop: 2 },
  ou: { textAlign: 'center', color: GRIS, marginVertical: 2, marginBottom: 12, fontWeight: '600' },
  champ: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: BORDURE,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: TEXTE,
    marginBottom: 12,
  },
  champCode: { fontSize: 22, letterSpacing: 6, textAlign: 'center', fontWeight: '700' },
  champMontant: { fontSize: 30, textAlign: 'center', fontWeight: '800' },
  champDate: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  texteDate: { fontSize: 16, color: TEXTE },
  indicationDate: { fontSize: 14, color: GRIS },

  // Carte du solde
  liste: { padding: 16, paddingTop: 8, paddingBottom: 40 },
  carteSolde: {
    borderRadius: 24,
    padding: 22,
    marginBottom: 16,
    overflow: 'hidden',
    ...ombre,
  },
  etiquetteSolde: { color: BLEU_TEXTE_CLAIR, fontSize: 15, fontWeight: '600' },
  solde: { color: '#fff', fontSize: 42, fontWeight: '800', marginVertical: 4 },
  objectif: { marginTop: 10 },
  objectifTexte: { color: '#fff', fontSize: 15, fontWeight: '700' },
  barre: {
    height: 10,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 5,
    marginVertical: 8,
    overflow: 'hidden',
  },
  barreRemplie: { height: '100%', backgroundColor: '#fff', borderRadius: 5 },
  objectifSous: { fontSize: 14 },
  lien: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 10,
    textDecorationLine: 'underline',
  },

  rangeeBoutons: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  titreSection: { fontSize: 19, fontWeight: '800', color: BLEU_FONCE, marginTop: 14, marginBottom: 10 },
  bandeauLecture: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 8,
    ...ombre,
  },
  texteBandeau: { color: BLEU_FONCE, fontSize: 15, fontWeight: '600', textAlign: 'center' },

  // Liste des tirelires
  carteListe: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 18,
    marginBottom: 12,
    gap: 12,
    ...ombre,
  },
  rangeeTitre: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { fontSize: 14 },
  barreListe: {
    height: 6,
    backgroundColor: BLEU_PALE,
    borderRadius: 3,
    marginTop: 8,
    overflow: 'hidden',
  },
  barreListeRemplie: { height: '100%', backgroundColor: BLEU, borderRadius: 3 },
  soldeListe: { fontSize: 19, fontWeight: '800', color: VERT },
  chevron: { fontSize: 26, color: '#94a3b8', marginLeft: 2 },

  // Historique
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    gap: 12,
    ...ombre,
  },
  pastille: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pastilleTexte: { fontSize: 20, fontWeight: '800' },
  ligneTitre: { fontSize: 16, fontWeight: '700', color: TEXTE, flexShrink: 1 },
  ligneSous: { fontSize: 13, color: GRIS, marginTop: 2 },
  ligneMontant: { fontSize: 16, fontWeight: '800' },
  vide: { textAlign: 'center', color: GRIS, marginTop: 24, fontSize: 15 },
  astuce: { textAlign: 'center', color: GRIS, marginTop: 8, fontSize: 13 },

  // Fenêtres
  fondModal: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,31,51,0.45)' },
  modal: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingTop: 10,
    paddingBottom: 36,
  },
  poignee: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: BORDURE,
    alignSelf: 'center',
    marginBottom: 14,
  },
  titreModal: { fontSize: 21, fontWeight: '800', color: BLEU_FONCE, marginBottom: 16 },
  infoPrenom: { textAlign: 'center', color: GRIS, marginTop: 14, fontSize: 13 },
  lienRouge: {
    textAlign: 'center',
    color: ROUGE,
    fontWeight: '700',
    marginTop: 12,
    fontSize: 15,
  },

  // Boutons
  bouton: {
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  boutonSecondaire: { backgroundColor: '#fff', borderWidth: 1, borderColor: BORDURE },
  texteBouton: { color: '#fff', fontSize: 16, fontWeight: '800' },

  lienSupprimer: {
    textAlign: 'center',
    color: '#9f1d1d',
    fontSize: 13,
    marginTop: 14,
    textDecorationLine: 'underline',
  },

  // Erreur
  erreur: { fontSize: 16, color: ROUGE, textAlign: 'center', marginBottom: 16 },
});
