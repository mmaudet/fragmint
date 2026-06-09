# Scénario démo Maudet — 12 juin 2026

**Durée cible:** 15-20 minutes + questions

---

## Intro (1 min)

> "Aujourd'hui je vais vous montrer Fragmint dans son architecture cible : un système où chaque donnée est un fragment réutilisable, indépendamment de sa forme de rendu. Concrètement, un engagement SLA stocké une fois peut apparaître dans une propale comme ligne de tableau, comme phrase argumentaire, ou comme donnée chiffrée. Et inversement, un tableau dans un document source est automatiquement décomposé en fragments atomiques pour réutilisation."

---

## Acte 1 — L'ingestion intelligente (3-4 min)

**Action :** Upload d'un docx Linagora contenant :
- Du contenu prose (présentation, méthodologie)
- Un tableau SLA : colonnes `Niveau / Prise en charge / Résolution / Pénalité`, 4-6 lignes
- Optionnel : tableau de références clients

**Ce qu'on montre :**
1. UI admin pipeline harvest — candidates apparaissent
2. Fragments prose classés normalement
3. Tableau SLA décomposé en 4-6 fragments individuels avec payload structuré visible
4. Collection "Engagements SLA" auto-créée

**Wow phrase :** *"Le système ne s'est pas contenté d'extraire le texte du tableau. Il a identifié la structure, inféré le schéma de données, et créé une collection réutilisable. Chaque ligne est maintenant une donnée indépendante."*

**Action :** Bulk approve collection + fragments en un clic.

---

## Acte 2 — La composition conversationnelle (5-7 min)

**Action :** Ouvrir OpenCode dans une fenêtre à côté.

**Prompt 1 :**
```
/fragmint compose — Je veux faire une propale pour le Conseil National des Barreaux.
Plan : présentation Linagora, expertise sur les barreaux, engagements SLA, références secteur public.
```

OpenCode → génère un plan, propose des candidats par section, validation interactive.

**Prompt 2 (wow conversationnel) :**
```
Pour la section engagements SLA, utilise la collection qu'on vient d'ingérer
mais retire le niveau Mineur et le niveau Négligeable.
Mets en avant la Disponibilité garantie en plus.
```

OpenCode → affiche la collection → recompose un tableau personnalisé (3 lignes originales + 1 ligne "Disponibilité") → confirme la sélection.

**Prompt 3 (polyvalence prose/table) :**
```
Dans l'introduction de la section, je veux une phrase qui mette en avant
notre engagement de prise en charge sous 30 minutes pour les incidents critiques.
```

OpenCode → récupère `sla-critique` (déjà utilisé en ligne de tableau) → l'insère en mode prose dans l'introduction.

**Wow phrase :** *"Le fragment sla-critique apparaît deux fois dans le document : une fois comme ligne de tableau dans la section 3, une fois comme phrase argumentaire dans l'introduction. Une seule donnée source, deux rendus différents. Si demain le SLA passe de 30 à 25 minutes, je modifie le fragment une seule fois et les deux occurrences se mettent à jour."*

---

## Acte 3 — L'export multi-format (3-4 min)

**Action :** Export docx → montrer :
- Tableaux Word natifs (stylés, pas du markdown converti)
- Sections prose bien formatées
- Le même fragment en table ET en prose dans le même doc

**Action :** Export pptx → montrer :
- Slides avec tableaux PowerPoint natifs
- Cohérence visuelle avec le docx

**Wow phrase :** *"Mêmes données, deux formats, qualité native dans chacun."*

---

## Acte 4 — La modification en aval (2-3 min)

**Action :** UI admin → ouvrir fragment `sla-critique`

**Ce qu'on montre :**
- Payload structuré : `niveau: Critique, prise_en_charge: 30min, resolution: 8h, penalite: 5%`
- Modifier `prise_en_charge: 30min` → `prise_en_charge: 25min`
- Sauver
- Retourner au plan → relancer l'export

**Résultat :** Docx et pptx régénérés avec la nouvelle valeur, partout où le fragment apparaît.

**Wow phrase :** *"Source of truth unique. Modification au niveau du fragment, propagation automatique dans tous les rendus."*

---

## Acte 5 — Conclusion (1-2 min)

> "Ce que vous venez de voir, c'est l'architecture polymorphe de Fragmint :
> - Ingestion intelligente qui décompose les tableaux sources
> - Composition conversationnelle via OpenCode qui pioche dans des collections existantes ou compose à la volée
> - Rendu polymorphe : même fragment en table, prose, ou data-point selon le contexte
> - Source of truth unique : modifier une donnée, propager partout
> - Export multi-format natif : docx et pptx avec qualité Office native"

---

## Fixtures à préparer avant la démo

- [ ] `demo-fixtures/sla-document.docx` — docx avec tableau SLA 5 lignes (Critique/Majeur/Modéré/Mineur/Négligeable) + prose présentation Linagora
- [ ] Template Word `base-plan.docx` généré par script (Task 11)
- [ ] Compte admin + token prêts
- [ ] OpenCode configuré avec skill `/fragmint`
- [ ] Base de données vide ou nettoyée pour démo propre
