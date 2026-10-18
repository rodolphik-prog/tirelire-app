import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
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
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
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
const PLACEHOLDER = '#c4c8cf'; // gris très clair des textes d'exemple dans les champs

// ---------- Mémoire du téléphone ----------
const CLE_CODES = 'tirelire:codes'; // liste des tirelires suivies sur ce téléphone
const CLE_CODE_ANCIEN = 'tirelire:code'; // ancienne version : une seule tirelire
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
  const [codes, setCodes] = useState([]); // toutes les tirelires suivies (une par enfant, par exemple)
  const [ouverte, setOuverte] = useState(null); // code de la tirelire affichée, ou null pour la liste
  const [ajout, setAjout] = useState(false); // écran "ajouter une tirelire"
  const [prenom, setPrenom] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [liste, ancien, p] = await Promise.all([
          AsyncStorage.getItem(CLE_CODES),
          AsyncStorage.getItem(CLE_CODE_ANCIEN),
          AsyncStorage.getItem(CLE_PRENOM),
        ]);
        if (liste) {
          setCodes(JSON.parse(liste));
        } else if (ancien) {
          // Reprend la tirelire de la version précédente de l'appli.
          setCodes([ancien]);
          await AsyncStorage.setItem(CLE_CODES, JSON.stringify([ancien]));
        }
        if (p) setPrenom(p);
      } catch (e) {
        // Pas grave : on repart de l'écran d'accueil.
      }
      setChargement(false);
    })();
  }, []);

  async function enregistrerCodes(liste) {
    setCodes(liste);
    try {
      await AsyncStorage.setItem(CLE_CODES, JSON.stringify(liste));
    } catch (e) {}
  }

  async function entrer(code, nouveauPrenom) {
    if (!codes.includes(code)) await enregistrerCodes([...codes, code]);
    try {
      await AsyncStorage.setItem(CLE_PRENOM, nouveauPrenom);
    } catch (e) {}
    setPrenom(nouveauPrenom);
    setAjout(false);
    setOuverte(code);
  }

  function retirer(code) {
    enregistrerCodes(codes.filter((c) => c !== code));
    setOuverte(null);
  }

  if (chargement) {
    return (
      <SafeAreaView style={[styles.ecran, styles.centre]}>
        <ActivityIndicator size="large" color={VERT} />
      </SafeAreaView>
    );
  }
  if (ouverte) {
    return (
      <Tirelire
        code={ouverte}
        prenom={prenom}
        onRetour={() => setOuverte(null)}
        onQuitter={() => retirer(ouverte)}
      />
    );
  }
  if (ajout || codes.length === 0) {
    return (
      <Accueil
        prenomInitial={prenom}
        onEntrer={entrer}
        onRetour={codes.length > 0 ? () => setAjout(false) : null}
      />
    );
  }
  return (
    <ListeTirelires codes={codes} onOuvrir={setOuverte} onAjouter={() => setAjout(true)} />
  );
}

// ---------- Écran "Mes tirelires" ----------
function ListeTirelires({ codes, onOuvrir, onAjouter }) {
  const [soldes, setSoldes] = useState({});
  const majSolde = useCallback(
    (code, solde) =>
      setSoldes((avant) => (avant[code] === solde ? avant : { ...avant, [code]: solde })),
    []
  );
  const total = codes.reduce((t, c) => t + (soldes[c] || 0), 0);

  return (
    <SafeAreaView style={styles.ecran}>
      <View style={styles.entete}>
        <Text style={styles.nomTirelire}>🐷 Mes tirelires</Text>
      </View>
      <FlatList
        data={codes}
        keyExtractor={(c) => c}
        ListHeaderComponent={
          codes.length > 1 ? (
            <View style={[styles.carteSolde, total < 0 && { backgroundColor: ROUGE }]}>
              <Text style={[styles.etiquetteSolde, total < 0 && { color: '#ffcdd2' }]}>
                Total de toutes les tirelires
              </Text>
              <Text style={styles.solde}>{formatEuros(total)}</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <CarteTirelire code={item} onOuvrir={() => onOuvrir(item)} onSolde={majSolde} />
        )}
        ListFooterComponent={
          <Bouton
            titre="+ Ajouter une tirelire"
            onPress={onAjouter}
            couleur={ROSE}
            style={{ marginTop: 8 }}
          />
        }
        contentContainerStyle={styles.liste}
      />
    </SafeAreaView>
  );
}

function CarteTirelire({ code, onOuvrir, onSolde }) {
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

  return (
    <Pressable
      onPress={onOuvrir}
      style={({ pressed }) => [styles.carteListe, pressed && { opacity: 0.7 }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.ligneTitre} numberOfLines={1}>
          {erreur ? `Tirelire ${code}` : infos ? infos.nom : '…'}
        </Text>
        <Text style={styles.ligneSous} numberOfLines={1}>
          {erreur
            ? 'Introuvable ou inaccessible'
            : solde !== null && solde < 0
            ? 'Avance à rembourser'
            : objectif > 0
            ? `Objectif ${formatEuros(objectif)} · ${Math.floor(progression * 100)} %`
            : `Code ${code}`}
        </Text>
        {objectif > 0 && !erreur && (
          <View style={styles.barreListe}>
            <View style={[styles.barreListeRemplie, { width: `${progression * 100}%` }]} />
          </View>
        )}
      </View>
      <Text style={[styles.soldeListe, solde !== null && solde < 0 && { color: ROUGE }]}>
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

  // Bouton "retour" d'Android : revient à la liste des tirelires.
  useEffect(() => {
    if (!onRetour) return undefined;
    const abonnement = BackHandler.addEventListener('hardwareBackPress', () => {
      onRetour();
      return true;
    });
    return () => abonnement.remove();
  }, [onRetour]);

  return (
    <SafeAreaView style={styles.ecran}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.accueil} keyboardShouldPersistTaps="handled">
          {onRetour && (
            <Pressable onPress={onRetour} hitSlop={10} style={{ alignSelf: 'flex-start' }}>
              <Text style={styles.lienRetour}>‹ Mes tirelires</Text>
            </Pressable>
          )}
          <Text style={styles.logo}>🐷</Text>
          <Text style={styles.titreAccueil}>Tirelire</Text>
          <Text style={styles.sousTitre}>Épargnez seul ou à plusieurs</Text>

          <Text style={styles.etiquette}>Ton prénom</Text>
          <TextInput
            placeholderTextColor={PLACEHOLDER}
            style={styles.champ}
            placeholder="Par exemple : Léa"
            value={prenom}
            onChangeText={setPrenom}
            maxLength={30}
          />

          <View style={styles.carte}>
            <Text style={styles.titreCarte}>Créer une nouvelle tirelire</Text>
            <TextInput
            placeholderTextColor={PLACEHOLDER}
              style={styles.champ}
              placeholder="Nom : prénom de l'enfant, Vacances…"
              value={nom}
              onChangeText={setNom}
              maxLength={40}
            />
            <Bouton titre="Créer la tirelire" onPress={creer} desactive={occupe} />
          </View>

          <Text style={styles.ou}>ou</Text>

          <View style={styles.carte}>
            <Text style={styles.titreCarte}>Rejoindre une tirelire</Text>
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
            <Bouton titre="Rejoindre" onPress={rejoindre} desactive={occupe} couleur={ROSE} />
          </View>

          {occupe && <ActivityIndicator style={{ marginTop: 16 }} color={VERT} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------- Écran principal d'une tirelire ----------
function Tirelire({ code, prenom, onRetour, onQuitter }) {
  const [infos, setInfos] = useState(null);
  const [operations, setOperations] = useState([]);
  const [erreur, setErreur] = useState(null);
  const [saisie, setSaisie] = useState(null); // 'ajout', 'retrait' ou null
  const [reglages, setReglages] = useState(false);

  // Bouton "retour" d'Android : revient à la liste des tirelires.
  useEffect(() => {
    const abonnement = BackHandler.addEventListener('hardwareBackPress', () => {
      onRetour();
      return true;
    });
    return () => abonnement.remove();
  }, [onRetour]);

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

  // date : null = maintenant (heure du serveur), sinon la date choisie dans le calendrier.
  // Renvoie true si la fenêtre peut se fermer tout de suite.
  function enregistrerOperation(type, centimes, note, date, fermer) {
    function ecrire() {
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
        <Bouton titre="‹ Mes tirelires" onPress={onRetour} secondaire style={{ alignSelf: 'stretch' }} />
        <Pressable onPress={onQuitter} hitSlop={8}>
          <Text style={styles.lienRouge}>Retirer de mes tirelires</Text>
        </Pressable>
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
  const avance = solde < 0; // solde négatif = argent avancé à l'enfant
  const texteClair = { color: avance ? '#ffcdd2' : '#c8e6c9' };

  const enTete = (
    <View>
      <View style={[styles.carteSolde, avance && { backgroundColor: ROUGE }]}>
        <Text style={[styles.etiquetteSolde, texteClair]}>
          {avance ? 'Avance à rembourser' : 'Dans la tirelire'}
        </Text>
        <Text style={styles.solde}>{formatEuros(solde)}</Text>

        {objectif > 0 ? (
          <Pressable onPress={() => setReglages(true)} style={styles.objectif}>
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
        <Pressable onPress={onRetour} hitSlop={12} style={styles.boutonRetour}>
          <Text style={styles.texteRetour}>‹</Text>
        </Pressable>
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
        onValider={(centimes, note, date, fermer) =>
          enregistrerOperation(saisie, centimes, note, date, fermer)
        }
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
  const [date, setDate] = useState(new Date());
  const [dateModifiee, setDateModifiee] = useState(false);
  const ajout = type === 'ajout';

  useEffect(() => {
    if (type) {
      setMontant('');
      setNote('');
      setDate(new Date());
      setDateModifiee(false);
    }
  }, [type]);

  function choisirDate() {
    DateTimePickerAndroid.open({
      value: date,
      mode: 'date',
      onValueChange: (evenement, choisie) => {
        if (!choisie) return;
        // On garde l'heure actuelle pour que les opérations du même jour restent dans l'ordre.
        const maintenant = new Date();
        const nouvelle = new Date(choisie);
        nouvelle.setHours(maintenant.getHours(), maintenant.getMinutes(), maintenant.getSeconds(), 0);
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
          <Text style={styles.titreModal}>
            {ajout ? "Ajouter de l'argent" : "Retirer de l'argent"}
          </Text>
          <TextInput
            placeholderTextColor={PLACEHOLDER}
            style={[styles.champ, styles.champMontant]}
            placeholder="0,00 €"
            keyboardType="decimal-pad"
            value={montant}
            onChangeText={setMontant}
            autoFocus
          />
          <Pressable onPress={choisirDate} style={[styles.champ, styles.champDate]}>
            <Text style={styles.texteDate}>📅  {formatJour(date)}</Text>
            <Text style={styles.indicationDate}>
              {memeJour(date, new Date()) ? "aujourd'hui · modifier" : 'modifier'}
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
      'Retirer de mes tirelires ?',
      `Elle disparaît seulement de ce téléphone, elle n'est pas supprimée. Tu pourras la rajouter plus tard avec le code ${code}.`,
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
          <Text style={styles.titreModal}>Réglages</Text>

          <Text style={styles.etiquette}>Nom de la tirelire</Text>
          <TextInput style={styles.champ} value={nom} onChangeText={setNom} maxLength={40} />

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
            <Bouton titre="Enregistrer" onPress={enregistrer} style={{ flex: 1 }} />
          </View>

          <Text style={styles.infoPrenom}>
            Connecté en tant que {prenom} · code {code}
          </Text>
          <Pressable onPress={confirmerQuitter} hitSlop={8}>
            <Text style={styles.lienRouge}>Retirer de mes tirelires</Text>
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
  champDate: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  texteDate: { fontSize: 16, color: TEXTE },
  indicationDate: { fontSize: 14, color: GRIS },

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

  // Navigation et liste des tirelires
  boutonRetour: { paddingRight: 12, paddingVertical: 4 },
  texteRetour: { fontSize: 34, lineHeight: 36, color: TEXTE, fontWeight: '300' },
  lienRetour: { fontSize: 16, color: VERT, fontWeight: '600', marginBottom: 8 },
  carteListe: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BORDURE,
    gap: 12,
  },
  barreListe: {
    height: 6,
    backgroundColor: VERT_CLAIR,
    borderRadius: 3,
    marginTop: 8,
    overflow: 'hidden',
  },
  barreListeRemplie: { height: '100%', backgroundColor: VERT, borderRadius: 3 },
  soldeListe: { fontSize: 18, fontWeight: '800', color: VERT },
  chevron: { fontSize: 26, color: GRIS, marginLeft: 2 },

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
