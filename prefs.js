import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

export default class LvOSKPrefs {
    fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup();
        const row = new Adw.PreferencesRow();
        row.set_child(new Gtk.Label({
            label: 'Marcin ssie pałe',
            hexpand: true,
            halign: Gtk.Align.CENTER,
            margin_top: 12,
            margin_bottom: 12,
        }));
        group.add(row);
        page.add(group);
        window.add(page);
    }
}
