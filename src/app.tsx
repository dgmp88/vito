import AuthGate from "./components/AuthGate";
import Home from "./routes/index";
import "./app.css";

export default function App() {
  return (
    <AuthGate>
      <Home />
    </AuthGate>
  );
}
