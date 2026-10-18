import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';

// ---------- Couleurs ----------
const VERT = '#2e7d32';
const VERT_CLAIR = '#e8f5e9';
const ROUGE = '#c62828';
const ROUGE_CLAIR = '#ffebee';
const ROSE = '#f48fb1';
const FOND = '#f6f7f9';
const TEXTE = '#1f2933';
const GRIS = '#6b7280';
const BORDURE = '#e5e7eb';

// ---------- Mémoire du téléphone ----------
const CLE_CODE = 'tirelire:code';
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

function formatDate(date) {
  if (!date) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()} à ${p(date.getHours())}h${p(date.getMinutes())}`;
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

// ---------- Application ----------
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Racine />
    </SafeAreaProvider>
  );
}

function Racine() {
  const [chargement, setChargement] = useState(true);
  const [code, setCode] = useState(null);
  const [prenom, setPrenom] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [c, p] = await Promise.all([
          AsyncStorage.getItem(CLE_CODE),
          AsyncStorage.getItem(CLE_PRENOM),
        ]);
        if (c) setCode(c);
        if (p) setPrenom(p);
      } catch (e) {
        // Pas grave : on repart de l'écran d'accueil.
      }
      setChargement(false);
    })();
  }, []);

  async function entrer(nouveauCode, nouveauPrenom) {
    try {
      await AsyncStorage.multiSet([
        [CLE_CODE, nouveauCode],
        [CLE_PRENOM, nouveauPrenom],
      ]);
    } catch (e) {
      // La tirelire fonctionne quand même, elle ne sera juste pas mémorisée.
    }
    setPrenom(nouveauPrenom);
    setCode(nouveauCode);
  }

  async function quitter() {
    try {
      await AsyncStorage.removeItem(CLE_CODE);
    } catch (e) {}
    setCode(null);
  }

  if (chargement) {
    return (
      <SafeAreaView style={[styles.ecran, styles.centre]}>
        <ActivityIndicator size="large" color={VERT} />
      </SafeAreaView>
    );
  }
  if (!code) {
    return <Accueil prenomInitial={prenom} onEntrer={entrer} />;
  }
  return <Tirelire code={code} prenom={prenom} onQuitter={quitter} />;
}

// ---------- Écran d'accueil : créer ou rejoindre une tirelire ----------
function Accueil({ prenomInitial, onEntrer }) {
  const [prenom, setPrenom] = useState(prenomInitial || '');
  const [nom, setNom] = useState('');
  const [codeSaisi, setCodeSaisi] = useState('');
  const [occupe, setOccupe] = useState(false);

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
      let nouveauCode = genererCode();
      while ((await getDoc(doc(db, 'tirelires', nouveauCode))).exists()) {
        nouveauCode = genererCode();
      }
      await setDoc(doc(db, 'tirelires', nouveauCode), {
        nom: nom.trim() || 'Ma tirelire',
        objectif: null,
        objectifNom: '',
        creePar: p,
        creeLe: serverTimestamp(),
      });
      await onEntrer(nouveauCode, p);
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
      const snap = await getDoc(doc(db, 'tirelires', c));
      if (!snap.exists()) {
        Alert.alert('Introuvable', 'Aucune tirelire ne porte ce code. Vérifie-le.');
        setOccupe(false);
        return;
      }
      await onEntrer(c, p);
    } catch (e) {
      Alert.alert('Erreur', messageErreur(e));
      setOccupe(false);
    }
  }

  return (
    <SafeAreaView style={styles.ecran}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.accueil} keyboardShouldPersistTaps="handled">
          <Text style={styles.logo}>🐷</Text>
          <Text style={styles.titreAccueil}>Tirelire</Text>
          <Text style={styles.sousTitre}>Épargnez seul ou à plusieurs</Text>

          <Text style={styles.etiquette}>Ton prénom</Text>
          <TextInput
            style={styles.champ}
            placeholder="Par exemple : Léa"
            value={prenom}
            onChangeText={setPrenom}
            maxLength={30}
          />

          <View style={styles.carte}>
            <Text style={styles.titreCarte}>Créer une nouvelle tirelire</Text>
            <TextInput
              style={styles.champ}
              placeholder="Nom (facultatif) : Vacances, Vélo…"
              value={nom}
              onChangeText={setNom}
              maxLength={40}
            />
            <Bouton titre="Créer ma tirelire" onPress={creer} desactive={occupe} />
          </View>

          <Text style={styles.ou}>ou</Text>

          <View style={styles.carte}>
            <Text style={styles.titreCarte}>Rejoindre une tirelire</Text>
            <TextInput
              style={[styles.champ, styles.champCode]}
              placeholder="CODE"
              value={codeSaisi}
              onChangeText={(t) => setCodeSaisi(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
            />
            <Bouton titre="Rejoindre" onPress={rejoindre} desactive={occupe} couleur={ROSE} />
          </View>

          {occupe && <ActivityIndicator style={{ marginTop: 16 }} color={VERT} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------- Écran principal d'une tirelire ----------
function Tirelire({ code, prenom, onQuitter }) {
  const [infos, setInfos] = useState(null);
  const [operations, setOperations] = useState([]);
  const [erreur, setErreur] = useState(null);
  const [saisie, setSaisie] = useState(null); // 'ajout', 'retrait' ou null
  const [reglages, setReglages] = useState(false);

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
      (e) => setErreur(messageErreur(e))
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

  function enregistrerOperation(type, centimes, note) {
    if (type === 'retrait' && centimes > solde) {
      Alert.alert('Solde insuffisant', `Il n'y a que ${formatEuros(solde)} dans la tirelire.`);
      return false;
    }
    // Pas de "await" : l'opération s'affiche tout de suite, même avec une connexion lente.
    addDoc(collection(db, 'tirelires', code, 'operations'), {
      montant: type === 'ajout' ? centimes : -centimes,
      note: note.trim(),
      auteur: prenom,
      date: serverTimestamp(),
    }).catch((e) => Alert.alert('Erreur', messageErreur(e)));
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

  async function partager() {
    try {
      await Share.share({
        message: `Rejoins ma tirelire « ${infos ? infos.nom : ''} » dans l'appli Tirelire avec le code : ${code}`,
      });
    } catch (e) {}
  }

  if (erreur) {
    return (
      <SafeAreaView style={[styles.ecran, styles.centre]}>
        <Text style={styles.erreur}>{erreur}</Text>
        <Bouton titre="Changer de tirelire" onPress={onQuitter} secondaire />
      </SafeAreaView>
    );
  }

  if (!infos) {
    return (
      <SafeAreaView style={[styles.ecran, styles.centre]}>
        <ActivityIndicator size="large" color={VERT} />
      </SafeAreaView>
    );
  }

  const objectif = infos.objectif || 0;
  const progression = objectif > 0 ? Math.max(0, Math.min(1, solde / objectif)) : 0;

  const enTete = (
    <View>
      <View style={styles.carteSolde}>
        <Text style={styles.etiquetteSolde}>Dans la tirelire</Text>
        <Text style={styles.solde}>{formatEuros(solde)}</Text>

        {objectif > 0 ? (
          <Pressable onPress={() => setReglages(true)} style={styles.objectif}>
            <Text style={styles.objectifTexte} numberOfLines={1}>
              🎯 {infos.objectifNom ? infos.objectifNom : 'Objectif'} : {formatEuros(objectif)}
            </Text>
            <View style={styles.barre}>
              <View style={[styles.barreRemplie, { width: `${progression * 100}%` }]} />
            </View>
            <Text style={styles.objectifSous}>
              {solde >= objectif
                ? 'Objectif atteint ! 🎉'
                : `Encore ${formatEuros(objectif - solde)} · ${Math.floor(progression * 100)} %`}
            </Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => setReglages(true)} hitSlop={8}>
            <Text style={styles.lien}>🎯 Fixer un objectif d'épargne</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.rangeeBoutons}>
        <Bouton titre="+ Ajouter" onPress={() => setSaisie('ajout')} style={{ flex: 1 }} />
        <Bouton
          titre="− Retirer"
          onPress={() => setSaisie('retrait')}
          style={{ flex: 1 }}
          couleur={ROUGE}
        />
      </View>

      <Text style={styles.titreSection}>Historique</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.ecran}>
      <View style={styles.entete}>
        <View style={{ flex: 1 }}>
          <Text style={styles.nomTirelire} numberOfLines={1}>
            🐷 {infos.nom}
          </Text>
          <Pressable onPress={partager} hitSlop={8}>
            <Text style={styles.code}>
              Code : <Text style={styles.codeGras}>{code}</Text> · Partager
            </Text>
          </Pressable>
        </View>
        <Pressable onPress={() => setReglages(true)} style={styles.boutonReglages} hitSlop={8}>
          <Text style={styles.texteReglages}>Réglages</Text>
        </Pressable>
      </View>

      <FlatList
        data={operations}
        keyExtractor={(op) => op.id}
        ListHeaderComponent={enTete}
        ListEmptyComponent={
          <Text style={styles.vide}>Aucune opération pour l'instant. Ajoute ta première pièce !</Text>
        }
        ListFooterComponent={
          operations.length > 0 ? (
            <Text style={styles.astuce}>Appui long sur une opération pour la supprimer.</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <LigneOperation op={item} onSupprimer={() => supprimerOperation(item)} />
        )}
        contentContainerStyle={styles.liste}
      />

      <FenetreMontant
        type={saisie}
        onFermer={() => setSaisie(null)}
        onValider={(centimes, note) => enregistrerOperation(saisie, centimes, note)}
      />

      <FenetreReglages
        visible={reglages}
        infos={infos}
        code={code}
        prenom={prenom}
        onFermer={() => setReglages(false)}
        onEnregistrer={enregistrerReglages}
        onQuitter={() => {
          setReglages(false);
          onQuitter();
        }}
      />
    </SafeAreaView>
  );
}

// ---------- Une ligne de l'historique ----------
function LigneOperation({ op, onSupprimer }) {
  const positif = op.montant >= 0;
  return (
    <Pressable
      onLongPress={onSupprimer}
      style={({ pressed }) => [styles.ligne, pressed && { opacity: 0.7 }]}
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
function FenetreMontant({ type, onFermer, onValider }) {
  const [montant, setMontant] = useState('');
  const [note, setNote] = useState('');
  const ajout = type === 'ajout';

  useEffect(() => {
    if (type) {
      setMontant('');
      setNote('');
    }
  }, [type]);

  function valider() {
    const centimes = enCentimes(montant);
    if (!centimes) {
      Alert.alert('Montant', 'Saisis un montant valide, par exemple 5 ou 12,50.');
      return;
    }
    if (onValider(centimes, note)) onFermer();
  }

  return (
    <Modal visible={!!type} transparent animationType="slide" onRequestClose={onFermer}>
      <KeyboardAvoidingView
        style={styles.fondModal}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modal}>
          <Text style={styles.titreModal}>
            {ajout ? "Ajouter de l'argent" : "Retirer de l'argent"}
          </Text>
          <TextInput
            style={[styles.champ, styles.champMontant]}
            placeholder="0,00 €"
            keyboardType="decimal-pad"
            value={montant}
            onChangeText={setMontant}
            autoFocus
          />
          <TextInput
            style={styles.champ}
            placeholder={ajout ? 'Note : argent de poche, anniversaire…' : 'Note : cadeau, sortie…'}
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
function FenetreReglages({ visible, infos, code, prenom, onFermer, onEnregistrer, onQuitter }) {
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

  function confirmerQuitter() {
    Alert.alert(
      'Quitter cette tirelire ?',
      `Elle ne sera pas supprimée. Tu pourras la rejoindre plus tard avec le code ${code}.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Quitter', style: 'destructive', onPress: onQuitter },
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
          <Text style={styles.titreModal}>Réglages</Text>

          <Text style={styles.etiquette}>Nom de la tirelire</Text>
          <TextInput style={styles.champ} value={nom} onChangeText={setNom} maxLength={40} />

          <Text style={styles.etiquette}>Objectif d'épargne (laisser vide pour aucun)</Text>
          <TextInput
            style={styles.champ}
            placeholder="Montant en €"
            keyboardType="decimal-pad"
            value={objectif}
            onChangeText={setObjectif}
          />
          <TextInput
            style={styles.champ}
            placeholder="Pour quoi ? (vélo, vacances…)"
            value={objectifNom}
            onChangeText={setObjectifNom}
            maxLength={40}
          />

          <View style={styles.rangeeBoutons}>
            <Bouton titre="Annuler" secondaire onPress={onFermer} style={{ flex: 1 }} />
            <Bouton titre="Enregistrer" onPress={enregistrer} style={{ flex: 1 }} />
          </View>

          <Text style={styles.infoPrenom}>
            Connecté en tant que {prenom} · code {code}
          </Text>
          <Pressable onPress={confirmerQuitter} hitSlop={8}>
            <Text style={styles.lienRouge}>Quitter cette tirelire</Text>
          </Pressable>
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
const styles = StyleSheet.create({
  ecran: { flex: 1, backgroundColor: FOND },
  centre: { alignItems: 'center', justifyContent: 'center', padding: 24 },

  // Accueil
  accueil: { padding: 24, paddingTop: 40 },
  logo: { fontSize: 64, textAlign: 'center' },
  titreAccueil: { fontSize: 32, fontWeight: '800', color: TEXTE, textAlign: 'center' },
  sousTitre: { fontSize: 16, color: GRIS, textAlign: 'center', marginBottom: 28 },
  etiquette: { fontSize: 14, fontWeight: '600', color: TEXTE, marginBottom: 6 },
  carte: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: BORDURE,
  },
  titreCarte: { fontSize: 17, fontWeight: '700', color: TEXTE, marginBottom: 12 },
  ou: { textAlign: 'center', color: GRIS, marginVertical: 12 },
  champ: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDURE,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: TEXTE,
    marginBottom: 12,
  },
  champCode: { fontSize: 22, letterSpacing: 6, textAlign: 'center', fontWeight: '700' },
  champMontant: { fontSize: 28, textAlign: 'center', fontWeight: '700' },

  // En-tête de la tirelire
  entete: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: BORDURE,
  },
  nomTirelire: { fontSize: 20, fontWeight: '800', color: TEXTE },
  code: { fontSize: 14, color: GRIS, marginTop: 2 },
  codeGras: { fontWeight: '700', color: TEXTE, letterSpacing: 1 },
  boutonReglages: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: FOND,
  },
  texteReglages: { fontSize: 14, fontWeight: '600', color: TEXTE },

  // Solde et objectif
  liste: { padding: 16, paddingBottom: 40 },
  carteSolde: {
    backgroundColor: VERT,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
  },
  etiquetteSolde: { color: '#c8e6c9', fontSize: 15 },
  solde: { color: '#fff', fontSize: 40, fontWeight: '800', marginVertical: 4 },
  objectif: { marginTop: 10 },
  objectifTexte: { color: '#fff', fontSize: 15, fontWeight: '600' },
  barre: {
    height: 10,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 5,
    marginVertical: 8,
    overflow: 'hidden',
  },
  barreRemplie: { height: '100%', backgroundColor: '#fff', borderRadius: 5 },
  objectifSous: { color: '#c8e6c9', fontSize: 14 },
  lien: { color: '#fff', fontSize: 15, fontWeight: '600', marginTop: 10, textDecorationLine: 'underline' },

  rangeeBoutons: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  titreSection: { fontSize: 18, fontWeight: '700', color: TEXTE, marginTop: 16, marginBottom: 8 },

  // Historique
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: BORDURE,
    gap: 12,
  },
  pastille: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pastilleTexte: { fontSize: 20, fontWeight: '800' },
  ligneTitre: { fontSize: 16, fontWeight: '600', color: TEXTE },
  ligneSous: { fontSize: 13, color: GRIS, marginTop: 2 },
  ligneMontant: { fontSize: 16, fontWeight: '700' },
  vide: { textAlign: 'center', color: GRIS, marginTop: 24, fontSize: 15 },
  astuce: { textAlign: 'center', color: GRIS, marginTop: 8, fontSize: 13 },

  // Fenêtres
  fondModal: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modal: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
  },
  titreModal: { fontSize: 20, fontWeight: '800', color: TEXTE, marginBottom: 16 },
  infoPrenom: { textAlign: 'center', color: GRIS, marginTop: 16, fontSize: 13 },
  lienRouge: { textAlign: 'center', color: ROUGE, fontWeight: '600', marginTop: 12, fontSize: 15 },

  // Boutons
  bouton: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  boutonSecondaire: { backgroundColor: FOND, borderWidth: 1, borderColor: BORDURE },
  texteBouton: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Erreur
  erreur: { fontSize: 16, color: ROUGE, textAlign: 'center', marginBottom: 16 },
});
