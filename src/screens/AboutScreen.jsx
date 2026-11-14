import { useLocale } from '../i18n/locale';
export default function AboutScreen() {
    const { tr } = useLocale();
    return (
        <section className="screen about">
            <h2>Elden Ring Save Editor</h2>
            <p>{tr("Versão 1.0.0")}</p>
            <ul>
                <li>{tr("O save, a conta e a pasta do jogo são encontrados sozinhos.")}</li>
                <li>{tr("Cada aplicação grava um backup em")} <code>_editor_backups</code>{tr(", ao lado do save. O arquivo")} <code>.sl2.bak</code> {tr("do jogo não é usado.")}</li>
                <li>{tr("Se a gravação não passar na verificação, ela é descartada.")}</li>
                <li>{tr("Códigos: ERE-01 jogo não encontrado, ERE-02 save não encontrado, ERE-03 jogo aberto, ERE-04 save inválido, ERE-05 versão só leitura, ERE-06 dados do jogo.")}</li>
            </ul>
            <p>{tr("Use offline. Item cortado, DLC que você não tem e quantidade acima do normal podem marcar a conta se você entrar online.")}</p>
        </section>
    );
}
