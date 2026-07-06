// Theme first: the tokens must exist before any component style evaluates.
import "./ui/theme.css";
// Then the shared form primitives (os-*) that build on those tokens.
import "./ui/forms.css";

import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./app.vue";
import { router } from "./router";

createApp(App).use(createPinia()).use(router).mount("#app");
