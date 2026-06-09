# Génération de sections et juge LLM de groundedness

> **Document de référence** — Architecture du pipeline de génération des sections de plan et du système de détection d'hallucinations (groundedness check).
>
> **Date** : 08 juin 2026

---

## Contexte

Une fois les fragments validés (Étape 2), l'utilisateur déclenche la génération de chaque section. Le LLM (mistral-nemo:12b ou ai.linagora.com) rédige un texte à partir des fragments sélectionnés. Quatre risques d'hallucination ont été identifiés :

| Risque | Description | Exemple |
|--------|-------------|---------|
| Reformulation inexacte | Le LLM paraphrase avec une nuance différente | "SLA 99.9%" → "garantie de 100% uptime" |
| Chiffres/dates modifiés | Le LLM invente des valeurs numériques | "depuis 2018" → "depuis 2016" |
| Conditions altérées | Les conditions contractuelles sont simplifiées ou omises | "disponible pour les entreprises > 500 employés" → "disponible pour toutes les entreprises" |
| Liens causaux inventés | Le LLM crée des relations de cause/effet absentes des fragments | "A, donc B" quand les fragments disent seulement "A" et "B" |

---

## Architecture du pipeline de génération

### Flux principal

```
Fragments sélectionnés (selected[])
    │
    ▼
buildSectionMessages()          ← plan-prompts.ts
    │
    ▼
LlmClient.chatMessages()        ← llm-client.ts (retry 429/503 × 3)
    │
    ▼
generated_markdown / blocks[]   ← sauvegardé en DB immédiatement
    │
    ▼
→ Réponse HTTP client           ← draft disponible SANS attendre le check
    │
    └──────────────────────────────────────────────────────┐
                                                           ▼
                                          scheduleGroundednessCheck()
                                          (fire-and-forget, semaphore)
                                                           │
                                                           ▼
                                          buildGroundednessMessages()
                                                           │
                                                           ▼
                                          LlmClient.chatMessages(temperature=0)
                                                           │
                                                           ▼
                                          parseGroundednessFlags()
                                                           │
                                                           ▼
                                          update(plan, { groundedness_flags })
```

### Génération des sections

Deux modes de génération dans `plan-assembler.ts` :

**Blocks mode** (sections avec `blocks[]`) : chaque bloc prose est généré indépendamment avec un `role` (`intro` / `conclusion` / `standalone`). La table des données est insérée depuis la collection sans passer par le LLM.

**Legacy mode** (sections sans `blocks[]`) : une seule passe LLM génère `generated_markdown`.

Dans les deux cas, `scheduleGroundednessCheck` est appelé après la génération avec la concaténation de tous les blocs prose.

---

## Groundedness check

### Principe

Un deuxième appel LLM à `temperature: 0` compare le texte généré avec les fragments source. Le LLM est invité à chercher activement les divergences — il ne peut pas répondre "tout va bien" sans justification.

**Paramètre clé : `temperature: 0`**
Élimine la créativité LLM pour ce check. Résultat déterministe et conservateur : le modèle se concentre sur la comparaison factuelle plutôt que sur la reformulation.

**Modèle identique au writer**
Même modèle que pour la génération, même endpoint. Pas de dépendance externe supplémentaire. Le modèle connaît ses propres habitudes de reformulation.

### Schéma de résultat

```typescript
// packages/server/src/schema/plan.ts
export const GroundednessFlagSchema = z.object({
  text: z.string(),          // extrait du texte généré (verbatim ou résumé)
  risk: z.enum(['high', 'medium', 'low']),
  reason: z.string(),        // explication en langage naturel
});
export type GroundednessFlag = z.infer<typeof GroundednessFlagSchema>;

// Champ dans PlanSectionSchema:
groundedness_flags: z.array(GroundednessFlagSchema).optional(),
```

### Niveaux de risque

| Niveau | Critère | Exemples |
|--------|---------|----------|
| `high` | Fait précis ou engagement contractuel non sourcé | Chiffre inventé, SLA non mentionné dans les fragments, affirmation de conformité |
| `medium` | Reformulation qui change le sens ou ajoute une implication | "peut" → "doit", omission d'une restriction |
| `low` | Ajout éditorial générique (transitions, tournures rhétoriques) | "comme nous l'avons vu", "il est important de noter" |

### Implémentation asynchrone

```typescript
// packages/server/src/services/plan-assembler.ts
private scheduleGroundednessCheck(
  planId: string,
  sectionId: string,
  draft: string,
  fragmentBodies: string[],
): void {
  void this.groundSemaphore(async () => {
    try {
      const msgs = buildGroundednessMessages(draft, fragmentBodies);
      const raw = await this.requireLlm().chatMessages(msgs, { temperature: 0 });
      const flags = parseGroundednessFlags(raw);
      const latest = await this.get(planId);
      if (!latest) return;
      const updated = latest.state.sections.map((s) =>
        s.id === sectionId ? { ...s, groundedness_flags: flags } : s,
      );
      await this.update(planId, { sections: updated });
    } catch (err) {
      console.warn(`[groundedness] section ${sectionId}:`, ...);
    }
  });
}
```

**Garanties :**
- `void` : le draft est retourné au client sans attendre le check
- `groundSemaphore` : partage le même semaphore que les autres appels LLM (limite `FRAGMINT_LLM_CONCURRENCY`)
- `re-fetch` du plan avant update : évite les race conditions si deux sections se terminent simultanément
- Silencieux en cas d'erreur LLM : le `catch` log un warning sans propager

### Prompts

Fichier : `packages/server/src/services/plan-prompts.ts`

**`GROUNDEDNESS_SYSTEM`** — Instructions au juge LLM :
- Rôle : auditeur de rigueur factuelle, non éditeur de style
- Règles de flagging : asserter ce qui n'est pas dans les fragments, modifier un chiffre, changer une condition, créer un lien causal absent
- Format de réponse : JSON array `[{ text, risk, reason }, ...]`
- Si aucun problème : `[]`
- Pénalité explicite pour les faux positifs de style

**`buildGroundednessMessages(draft, fragmentBodies)`** — Construit les messages :
```
system: GROUNDEDNESS_SYSTEM
user:
  FRAGMENTS SOURCE:
  ---
  [fragment 1]
  ---
  [fragment 2]
  ...

  TEXTE GÉNÉRÉ:
  ---
  [draft]
  ---
```

**`parseGroundednessFlags(raw)`** — Parse la réponse :
- Extrait le premier tableau JSON de la réponse (regex `\[[\s\S]*\]`)
- Valide avec Zod `z.array(GroundednessFlagSchema)`
- Retourne `[]` sur toute erreur de parse ou de validation (fail-safe)

---

## Interface utilisateur

### Onglet Rédaction (DraftsStep)

**Point de couleur dans la sidebar** : chaque section affiche un point coloré selon le risque le plus élevé détecté.

| Couleur | Signification |
|---------|---------------|
| 🔴 rouge | Au moins un flag `high` |
| 🟠 orange | Au moins un flag `medium` (aucun `high`) |
| 🟡 jaune | Uniquement des flags `low` |
| *(absent)* | Aucun flag ou check non encore terminé |

**`GroundednessPanel`** (sous la textarea de draft) : liste des flags avec icône et badge coloré. Chaque flag affiche le passage incriminé et la raison.

```
┌─────────────────────────────────────────────────────┐
│ 🛡 Risque élevé                                      │
│ "garantie de 100% uptime"                           │
│ Le fragment source mentionne "99.9% SLA" sans       │
│ garantie absolue.                                   │
├─────────────────────────────────────────────────────┤
│ ⚠ Risque moyen                                      │
│ "disponible pour toutes les entreprises"            │
│ Le fragment précise "entreprises > 500 employés".   │
└─────────────────────────────────────────────────────┘
```

Le panel n'est pas bloquant : l'utilisateur peut ignorer les flags et exporter quand même.

---

## Comment tester

### Test manuel (demo)

1. Créer un plan avec des sections ayant des fragments tabulaires ou chiffrés
2. Valider les fragments (Étape 2)
3. Générer une section (Étape 3, bouton "Générer")
4. Le draft apparaît immédiatement
5. Attendre 5-15 secondes → recharger la page (ou observer le live-reload)
6. Les flags apparaissent dans `GroundednessPanel` sous la textarea

### Test de régression automatique

Les tests dans `packages/server/src/services/plan-prompts.test.ts` couvrent :
- `parseGroundednessFlags` avec une réponse valide
- `parseGroundednessFlags` avec JSON malformé → retourne `[]`
- `parseGroundednessFlags` avec tableau vide → retourne `[]`
- `buildGroundednessMessages` — structure des messages (system + user)

### Vérifier la propagation asynchrone

Dans les logs serveur (Docker) :
```
[groundedness] section <id>: <message d'erreur éventuel>
```

Aucun log = succès silencieux (les flags sont écrits en DB sans log de succès).

---

## Décisions architecturales

### Pourquoi asynchrone et non bloquant ?

Le check groundedness ajoute ~3-8s d'appel LLM. Bloquer la réponse HTTP le rendrait inutilisable sur ai.linagora.com. La génération de draft est la valeur primaire ; le check est un signal d'audit secondaire que l'utilisateur consulte après.

### Pourquoi le même modèle que le writer ?

Un modèle différent (ex. GPT-4) créerait une dépendance externe et une asymétrie : il aurait ses propres biais de reformulation qui pourraient masquer ou amplifier les vrais problèmes. Le même modèle connaît ses propres patterns de génération.

### Pourquoi pas de citation tracing (Option B) ?

Le citation tracing (`[fragment_id:X]` inline dans le draft) aurait requis de modifier le prompt writer pour produire des citations, ce qui aurait impacté la qualité du texte généré. L'audit post-génération (Option A) est non-intrusif.

### Limitations connues

- **Faux négatifs** : le LLM judge peut rater des hallucinations subtiles, notamment des reformulations idiomatiques qui préservent le sens littéral mais changent l'implication légale.
- **Faux positifs de style** : le prompt penalise explicitement les flags stylistiques, mais le modèle peut encore flagger des tournures rhétoriques sans risque réel.
- **Race condition** : si l'utilisateur modifie manuellement le draft pendant le check, les flags écrivent l'état précédent. Acceptable pour la demo — un guard sur le hash du draft corrigerait ça.
- **Pas de retry** : si le check LLM échoue (timeout, 429), les flags ne sont jamais écrits. Le LLM retry de `llm-client.ts` couvre les 429 transitoires.
