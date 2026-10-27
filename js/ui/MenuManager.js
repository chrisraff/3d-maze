/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */

export default class MenuManager extends EventTarget {
    constructor() {
        super();

        this.focusedMenu = null;
        const activeMenu = document.querySelector('.menu.menu-active');
        if (activeMenu) {
            this.focusedMenu = activeMenu.id;
        }

        this.menuStack = [];

        this.setUpTargetMenuCallbacks();
        this.setUpBackButtons();
    }

    setUpTargetMenuCallbacks() {
        document.querySelectorAll('[target-menu]').forEach((el) => {
            el.addEventListener('click', (evt) => {
                const targetMenu = el.getAttribute('target-menu');
                if (targetMenu) {
                    this.focusMenu(targetMenu);
                }
            });
        });
    }

    setUpBackButtons() {
        document.querySelectorAll('.menu-back-button').forEach((el) => {
            el.addEventListener('click', this.focusPreviousMenu.bind(this));
        });
    }

    focusPreviousMenu(event) {
        if (this.menuStack.length > 0) {
            const previousMenu = this.menuStack.pop();
            this.focusMenu(previousMenu, false);
        }
    }

    focusRootMenu(menu) {
        this.clearMenuHistory();
        this.focusMenu(menu, false);
    }

    focusMenu(menu, pushMenu = true) {
        // track the current menu on the stack
        const currentMenu = document.querySelector('.focusable-menu.menu-active');

        if (currentMenu && currentMenu.id === menu) {
            // if the menu we're trying to focus is already focused, do nothing
            return;
        }

        if (currentMenu) {
            if (pushMenu) {
                this.menuStack.push(currentMenu.id);
            }

            // hide the current menu
            currentMenu.classList.remove('menu-active');
            currentMenu.style.display = 'none';
        }

        // show the new menu
        const newMenu = document.getElementById(menu);
        newMenu.classList.add('menu-active');
        newMenu.style.display = '';

        this.focusedMenu = menu;

        // if this menu has a back button, set its visibility
        const backButton = newMenu.querySelector('.menu-back-button');
        if (backButton) {
            backButton.style.display = this.menuStack.length > 0 ? '' : 'none';
        }

        // if this menu has a root-only button, set its visibility
        newMenu.querySelectorAll('.menu-button-root-only').forEach((button) => {
            button.style.display = this.menuStack.length === 0 ? '' : 'none';
        });

        this.dispatchEvent(new CustomEvent('menuChanged', { detail: { menu } }));
    }

    clearMenuHistory() {
        this.menuStack = [];
        const currentMenu = document.querySelector('.focusable-menu.menu-active');
    }

    hideMenu() {
        const currentMenu = document.querySelector('.menu.menu-active');
        if (currentMenu) {
            currentMenu.classList.remove('menu-active');
            currentMenu.style.display = 'none';
        }
        this.focusedMenu = null;
    }
}
