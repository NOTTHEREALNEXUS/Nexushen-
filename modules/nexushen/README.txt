NEXUSHEN 0.1-dev — Dossier de préparation

Cette première brique propre au projet conserve l'identité NEXUSHEN, les notes
de développement et un inventaire de fichiers avec leurs empreintes SHA-256.
Elle permet d'exporter et de restaurer ce dossier au format JSON, séparément
des réglages et sauvegardes Guardian.

Le payload HEN natif NEXUSHEN n'est pas encore construit. La cible 14.02 est
déclarée pour le projet, et ne constitue pas une validation de compatibilité.
GoldHEN demeure un module tiers distinct, avec sa propre identité et ses crédits.

Étapes encore nécessaires :
- déterminer la base native, sa provenance et sa licence ;
- définir une compilation reproductible avec une version identifiable ;
- vérifier la sortie de compilation et documenter les tests sur console.

Les fichiers sélectionnés sont lus localement pour calculer leur empreinte.
Leur contenu n'est ni conservé par ce module, ni exécuté, ni envoyé en ligne.
L'empreinte identifie le contenu ; elle ne prouve pas son origine ou sa sûreté.

Le navigateur conserve deux générations du dossier et sélectionne la plus
récente dont le format et l'empreinte sont valides. L'effacement des données du
navigateur, un changement d'adresse ou un autre appareil nécessitent l'import
d'un export précédent. En cas de stockage indisponible, l'export reste accessible.

Fichiers :
- manifest.json : état et périmètre du projet ;
- project.js : validation, format JSON, stockage local ;
- app.js : inventaire et interface ;
- index.html, style.css : espace de préparation.

Les mécanismes SHA-256 et manette proviennent des composants NEXUSHEN déjà
présents sur le site. Ce module n'importe aucun script d'exploitation.
