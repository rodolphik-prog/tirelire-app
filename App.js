import React, { useState, useEffect } from 'react';
import { 
  Text, View, StyleSheet, ScrollView, ActivityIndicator, 
  TouchableOpacity, TextInput, Modal, Alert 
} from 'react-native';
import { db } from './firebase';
import { 
  collection, onSnapshot, addDoc, updateDoc, doc, setDoc,
  query, where, serverTimestamp 
} from 'firebase/firestore';

export default function App() {
  const [enfants, setEnfants] = useState([]);
  const [enfantSelectionne, setEnfantSelectionne] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isPremium, setIsPremium] = useState(false);

  // Formulaires
  const [nomEnfantInput, setNomEnfantInput] = useState('');
  const [montantInput, setMontantInput] = useState('');
  const [libelleInput, setLibelleInput] = useState('');
  const [afficherAjoutEnfant, setAfficherAjoutEnfant] = useState(false);

  // Paywall
  const [afficherPaywall, setAfficherPaywall] = useState(false);

  // 1. Écouter le statut Premium
  useEffect(() => {
    const unsubPremium = onSnapshot(doc(db, 'settings', 'premium'), (docSnap) => {
      if (docSnap.exists()) {
        setIsPremium(docSnap.data().unlocked || false);
      } else {
        setIsPremium(false);
      }
    });
    return () => unsubPremium();
  }, []);

  // 2. Écouter la liste des enfants
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'enfants'), (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setEnfants(data);

      if (data.length > 0 && !enfantSelectionne) {
        setEnfantSelectionne(data[0]);
      } else if (enfantSelectionne) {
        const maj = data.find(e => e.id === enfantSelectionne.id);
        if (maj) setEnfantSelectionne(maj);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 3. Écouter les transactions
  useEffect(() => {
    if (!enfantSelectionne) return;

    const q = query(
      collection(db, 'transactions'),
      where('enfantId', '==', enfantSelectionne.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      
      docs.sort((a, b) => {
        const timeA = a.date?.seconds || Date.now() / 1000;
        const timeB = b.date?.seconds || Date.now() / 1000;
        return timeB - timeA;
      });

      setTransactions(docs);
    });

    return () => unsubscribe();
  }, [enfantSelectionne?.id]);

  const activerPremium = async () => {
    try {
      await setDoc(doc(db, 'settings', 'premium'), {
        unlocked: true,
        dateAchat: serverTimestamp()
      });
      setAfficherPaywall(false);
      Alert.alert("Félicitations ! 🚀", "Accès Premium activé avec succès.");
    } catch (error) {
      console.error("Erreur activation Premium :", error);
    }
  };

  const modifierPrenom = async () => {
    if (!enfantSelectionne) return;
    const nouveauPrenom = prompt("Modifier le prénom :", enfantSelectionne.prenom);

    if (nouveauPrenom && nouveauPrenom.trim() !== '') {
      try {
        await updateDoc(doc(db, 'enfants', enfantSelectionne.id), {
          prenom: nouveauPrenom.trim()
        });
      } catch (error) {
        console.error("Erreur modification prénom :", error);
      }
    }
  };

  const ajouterEnfant = async () => {
    if (!nomEnfantInput.trim()) return;

    if (!isPremium && enfants.length >= 1) {
      setAfficherPaywall(true);
      return;
    }

    try {
      await addDoc(collection(db, 'enfants'), {
        prenom: nomEnfantInput.trim(),
        solde: 0
      });
      setNomEnfantInput('');
      setAfficherAjoutEnfant(false);
    } catch (error) {
      console.error("Erreur ajout enfant :", error);
    }
  };

  const modifierSolde = async (variation) => {
    if (!enfantSelectionne) return;

    const textePropre = montantInput.trim().replace(',', '.');
    const valeur = parseFloat(textePropre);

    if (!textePropre || isNaN(valeur) || valeur <= 0) {
      Alert.alert("Erreur", "Veuillez saisir un montant valide.");
      return;
    }

    const nouveauSolde = (enfantSelectionne.solde || 0) + (valeur * variation);

    try {
      await updateDoc(doc(db, 'enfants', enfantSelectionne.id), {
        solde: nouveauSolde
      });

      await addDoc(collection(db, 'transactions'), {
        enfantId: enfantSelectionne.id,
        montant: valeur * variation,
        libelle: libelleInput.trim() || (variation > 0 ? "Ajout d'argent" : "Dépense"),
        date: serverTimestamp()
      });

      setMontantInput('');
      setLibelleInput('');
    } catch (error) {
      console.error("Erreur mise à jour :", error);
    }
  };

  return (
    <View style={styles.container}>
      {/* Structure de fond : zone supérieure légèrement plus claire */}
      <View style={styles.bgHeaderPattern} />

      {/* En-tête principal */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.headerTitle}>Tirelire</Text>
          <Text style={styles.headerEmoji}>🐷</Text>
          {isPremium && (
            <View style={styles.premiumBadge}>
              <Text style={styles.premiumBadgeText}>PRO</Text>
            </View>
          )}
        </View>
        <Text style={styles.headerSubtitle}>Gestion de l'argent de poche</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#4F46E5" style={{ marginTop: 40 }} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          
          {/* Onglets Profils */}
          <View style={styles.section}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabRow}>
              {enfants.map(e => (
                <TouchableOpacity
                  key={e.id}
                  style={[styles.tab, enfantSelectionne?.id === e.id && styles.tabActive]}
                  onPress={() => setEnfantSelectionne(e)}
                >
                  <Text style={[styles.tabText, enfantSelectionne?.id === e.id && styles.tabTextActive]}>
                    {e.prenom}
                  </Text>
                </TouchableOpacity>
              ))}

              <TouchableOpacity 
                style={styles.tabAdd}
                onPress={() => setAfficherAjoutEnfant(!afficherAjoutEnfant)}
              >
                <Text style={styles.tabAddText}>+ Enfant</Text>
              </TouchableOpacity>
            </ScrollView>

            {afficherAjoutEnfant && (
              <View style={styles.addEnfantBox}>
                <TextInput
                  style={styles.inputInline}
                  placeholder="Prénom..."
                  placeholderTextColor="#94A3B8"
                  value={nomEnfantInput}
                  onChangeText={setNomEnfantInput}
                />
                <TouchableOpacity style={styles.btnAddSubmit} onPress={ajouterEnfant}>
                  <Text style={styles.btnAddSubmitText}>Ajouter</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Carte Principale Solde */}
          {enfantSelectionne && (
            <>
              <View style={styles.cardMain}>
                <View style={styles.cardHeader}>
                  <TouchableOpacity style={styles.childNameContainer} onPress={modifierPrenom}>
                    <Text style={styles.childName}>{enfantSelectionne.prenom}</Text>
                    <Text style={styles.editIcon}>✏️</Text>
                  </TouchableOpacity>
                  <View style={styles.badgeSoldeContainer}>
                    <Text style={styles.badgeSoldeText}>Solde courant</Text>
                  </View>
                </View>

                <View style={styles.soldeRow}>
                  <Text style={styles.soldeBig}>
                    {typeof enfantSelectionne.solde === 'number' ? enfantSelectionne.solde.toFixed(2) : '0.00'}
                  </Text>
                  <Text style={styles.currencySymbol}>€</Text>
                </View>

                {/* Formulaire de Transaction */}
                <View style={styles.actionCard}>
                  <View style={styles.inputsGroup}>
                    <TextInput
                      style={styles.inputField}
                      placeholder="Montant (ex: 5,00)"
                      placeholderTextColor="#94A3B8"
                      keyboardType="decimal-pad"
                      value={montantInput}
                      onChangeText={setMontantInput}
                    />
                    <TextInput
                      style={styles.inputField}
                      placeholder="Motif (ex: Argent de poche, Livre...)"
                      placeholderTextColor="#94A3B8"
                      value={libelleInput}
                      onChangeText={setLibelleInput}
                    />
                  </View>

                  <View style={styles.buttonGroup}>
                    <TouchableOpacity 
                      style={[styles.btnAction, styles.btnRetrait]} 
                      onPress={() => modifierSolde(-1)}
                    >
                      <Text style={styles.btnActionTextRetrait}>− Retirer</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={[styles.btnAction, styles.btnDepot]} 
                      onPress={() => modifierSolde(1)}
                    >
                      <Text style={styles.btnActionTextDepot}>+ Déposer</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* Historique des Transactions */}
              <View style={styles.sectionHistory}>
                <Text style={styles.sectionTitle}>Dernières opérations</Text>
                
                {transactions.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyStateEmoji}>🪙</Text>
                    <Text style={styles.emptyStateTitle}>Aucune transaction</Text>
                    <Text style={styles.emptyStateText}>Ajoutez du solde ou enregistrez une dépense ci-dessus.</Text>
                  </View>
                ) : (
                  transactions.map(t => (
                    <View key={t.id} style={styles.transacCard}>
                      <View style={[styles.iconTag, t.montant > 0 ? styles.iconPlus : styles.iconMinus]}>
                        <Text style={[styles.iconTagText, { color: t.montant > 0 ? '#10B981' : '#F43F5E' }]}>
                          {t.montant > 0 ? '↓' : '↑'}
                        </Text>
                      </View>

                      <View style={{ flex: 1, marginHorizontal: 12 }}>
                        <Text style={styles.transacTitle}>{t.libelle}</Text>
                        <Text style={styles.transacSub}>
                          {t.date ? new Date(t.date.seconds * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : 'À l\'instant'}
                        </Text>
                      </View>

                      <Text style={[styles.transacAmount, { color: t.montant > 0 ? '#059669' : '#E11D48' }]}>
                        {t.montant > 0 ? `+${t.montant.toFixed(2)}` : t.montant.toFixed(2)} €
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </>
          )}
        </ScrollView>
      )}

      {/* Paywall Modal */}
      <Modal visible={afficherPaywall} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalBadgeHeader}>
              <Text style={styles.modalEmoji}>⭐</Text>
            </View>
            <Text style={styles.modalTitle}>Débloquez Tirelire PRO</Text>
            <Text style={styles.modalBody}>
              Gérez le budget de toute la famille sans restriction de profils d'enfants.
            </Text>
            <TouchableOpacity style={styles.btnPaywall} onPress={activerPremium}>
              <Text style={styles.btnPaywallText}>Activer l'accès illimité (2,99 €)</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAfficherPaywall(false)}>
              <Text style={styles.btnPaywallClose}>Non merci</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#E2E8F0', // Fond global gris-ardoise structuré
    paddingTop: 60, 
    paddingHorizontal: 20 
  },
  
  // Bloc de structure supérieur pour créer un effet d'étage/profondeur
  bgHeaderPattern: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,
    backgroundColor: '#EEF2FF',
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    borderBottomWidth: 1,
    borderBottomColor: '#C7D2FE'
  },

  header: { marginBottom: 24 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontSize: 32, fontWeight: '900', color: '#0F172A' },
  headerEmoji: { fontSize: 30, marginLeft: 8 },
  headerSubtitle: { fontSize: 14, color: '#475569', marginTop: 2, fontWeight: '600' },
  premiumBadge: { backgroundColor: '#F59E0B', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginLeft: 10 },
  premiumBadgeText: { color: '#FFF', fontWeight: '800', fontSize: 10, letterSpacing: 0.5 },

  section: { marginBottom: 20 },
  tabRow: { flexDirection: 'row' },
  tab: { backgroundColor: '#CBD5E1', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, marginRight: 8 },
  tabActive: { backgroundColor: '#4F46E5' },
  tabText: { color: '#334155', fontWeight: '600', fontSize: 14 },
  tabTextActive: { color: '#FFFFFF', fontWeight: '700' },
  tabAdd: { backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#818CF8' },
  tabAddText: { color: '#4F46E5', fontWeight: '700', fontSize: 14 },

  addEnfantBox: { flexDirection: 'row', marginTop: 12, backgroundColor: '#FFFFFF', padding: 8, borderRadius: 16, borderWidth: 1, borderColor: '#CBD5E1', gap: 8 },
  inputInline: { flex: 1, paddingHorizontal: 12, fontSize: 14, color: '#0F172A' },
  btnAddSubmit: { backgroundColor: '#4F46E5', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, justifyContent: 'center' },
  btnAddSubmitText: { color: '#FFF', fontWeight: '700', fontSize: 13 },

  cardMain: { 
    backgroundColor: '#4F46E5', 
    borderRadius: 28, 
    padding: 22, 
    marginBottom: 24,
    shadowColor: '#312E81',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  childNameContainer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  childName: { fontSize: 24, fontWeight: '800', color: '#FFFFFF' },
  editIcon: { fontSize: 14, opacity: 0.8 },
  badgeSoldeContainer: { backgroundColor: 'rgba(255, 255, 255, 0.18)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  badgeSoldeText: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  
  soldeRow: { flexDirection: 'row', alignItems: 'baseline', marginVertical: 16 },
  soldeBig: { fontSize: 48, fontWeight: '900', color: '#FFFFFF', letterSpacing: -1 },
  currencySymbol: { fontSize: 28, fontWeight: '700', color: '#C7D2FE', marginLeft: 6 },

  actionCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 14, marginTop: 4 },
  inputsGroup: { gap: 8, marginBottom: 10 },
  inputField: { backgroundColor: '#F1F5F9', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#0F172A', fontWeight: '500', width: '100%' },
  
  buttonGroup: { flexDirection: 'row', gap: 10 },
  btnAction: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnDepot: { backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0' },
  btnRetrait: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  btnActionTextDepot: { color: '#059669', fontWeight: '700', fontSize: 14 },
  btnActionTextRetrait: { color: '#E11D48', fontWeight: '700', fontSize: 14 },

  sectionHistory: { marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: 14 },
  transacCard: { 
    backgroundColor: '#FFFFFF', 
    borderRadius: 18, 
    padding: 14, 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginBottom: 10, 
    borderWidth: 1, 
    borderColor: '#CBD5E1' 
  },
  iconTag: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  iconPlus: { backgroundColor: '#ECFDF5' },
  iconMinus: { backgroundColor: '#FEF2F2' },
  iconTagText: { fontWeight: '900', fontSize: 16 },
  transacTitle: { fontSize: 15, fontWeight: '700', color: '#1E293B' },
  transacSub: { fontSize: 12, color: '#64748B', marginTop: 2, fontWeight: '500' },
  transacAmount: { fontSize: 16, fontWeight: '800' },
  
  emptyState: { backgroundColor: '#FFFFFF', padding: 28, borderRadius: 20, alignItems: 'center', borderWidth: 1, borderColor: '#CBD5E1' },
  emptyStateEmoji: { fontSize: 32, marginBottom: 8 },
  emptyStateTitle: { fontSize: 15, fontWeight: '700', color: '#1E293B', marginBottom: 4 },
  emptyStateText: { color: '#64748B', fontSize: 13, textAlign: 'center' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#FFF', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 28, alignItems: 'center' },
  modalBadgeHeader: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FEF3C7', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  modalEmoji: { fontSize: 30 },
  modalTitle: { fontSize: 22, fontWeight: '900', color: '#0F172A', marginBottom: 8 },
  modalBody: { color: '#64748B', textAlign: 'center', lineHeight: 22, fontSize: 14, marginBottom: 24 },
  btnPaywall: { backgroundColor: '#4F46E5', paddingVertical: 16, paddingHorizontal: 20, borderRadius: 16, width: '100%', alignItems: 'center', marginBottom: 12 },
  btnPaywallText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  btnPaywallClose: { color: '#94A3B8', padding: 8, fontWeight: '600', fontSize: 14 }
});
