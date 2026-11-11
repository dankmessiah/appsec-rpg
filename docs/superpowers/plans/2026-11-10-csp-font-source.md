# Restrict CSP font sources

User approved preparing the CSP fix. The new baseline identifies wildcard font sources; public/styles.css uses installed system fonts and has no remote font declaration. Set only fontSrc to self in the shared Helmet policy. Preserve script/style/default policies and the existing LAN-specific upgrade-insecure-requests behavior.

Add a failing HTTP regression covering root HTML, app.js and health in both default and COOKIE_SECURE=false modes. Then add the explicit directive and run focused plus unit tests. Review in the coordinating session. This prepares a source fix; do not claim the deployed finding resolved until the reviewed image is deployed and its headers/scan are verified. No historical finding is dismissed.

## Verification and review

The two HTTP regression cases failed against the original font-src self/https/data policy, then passed with explicit self-only fontSrc. All 36 unit tests across six suites pass. The regression covers HTML, JavaScript and health responses in both default and LAN modes, preserving existing default/script/style directives and mode-specific upgrade-insecure-requests behavior. Session review confirmed one application-policy line changed, the CSS uses system fonts, and no dependencies or credentials changed. Full hosted checks and deployed-image verification remain separate evidence.
