import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Tirelire est en ligne !</Text>
      <Text style={styles.subtitle}>Le bundle se charge parfaitement sur Expo Go.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2e7d32',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#555555',
    textAlign: 'center',
  },
});
