package ai.voltessa.mobile.ui

import ai.voltessa.mobile.data.ApiResult
import ai.voltessa.mobile.data.AuthRepository
import ai.voltessa.mobile.data.AutomationSettingsResponse
import ai.voltessa.mobile.data.AutomationsRepository
import ai.voltessa.mobile.data.CurrentUserDto
import ai.voltessa.mobile.data.DashboardResponse
import ai.voltessa.mobile.data.MarketPageResponse
import ai.voltessa.mobile.data.MarketRepository
import ai.voltessa.mobile.data.PlantConnectionResponse
import ai.voltessa.mobile.data.PlantDto
import ai.voltessa.mobile.data.PlantsRepository
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class AppScreen { LOADING, LOGIN, MAIN }

/** M4 - the 6 primary sections, matching Web's own navigation exactly. */
enum class MainSection { DASHBOARD, MARKET, BESS, AUTOMATIONS, ALERTS, SETTINGS }

data class UiState(
    val screen: AppScreen = AppScreen.LOADING,
    val mainSection: MainSection = MainSection.DASHBOARD,
    val user: CurrentUserDto? = null,
    val isBusy: Boolean = false,
    val loginError: String? = null,

    // Dashboard (M4.1: Dashboard shows the selected/default plant's data
    // directly - there is no separate "pick a plant first" screen. `plants`
    // still holds the full list, only to power the compact selector shown
    // when there's more than one.)
    val plants: List<PlantDto> = emptyList(),
    val plantsError: String? = null,
    val selectedPlant: PlantDto? = null,
    val connection: PlantConnectionResponse? = null,
    val dashboard: DashboardResponse? = null,
    val detailError: String? = null,

    // Market (M4)
    val marketBusy: Boolean = false,
    val market: MarketPageResponse? = null,
    val marketError: String? = null,

    // Automations (M4)
    val automationsBusy: Boolean = false,
    val automationSettings: AutomationSettingsResponse? = null,
    val automationsError: String? = null,
    val automationsSaveMessage: String? = null,
)

/**
 * M4 - the app is now a real multi-section client (Dashboard/Market/BESS/
 * Automations/Alerts/Settings), navigated via a navigation drawer
 * (MainActivity), not a single linear Login -> Home -> Plants chain
 * anymore. Still one `UiState`/one ViewModel, no navigation library -
 * `mainSection` selects which section's own slice of state is shown,
 * exactly the same "keep it minimal" state-machine approach M2/M3 already
 * established, just extended. Dashboard itself has no further internal
 * "pick a plant" gate (M4.1) - it shows the selected/default plant's data
 * directly.
 */
class AppViewModel(
    private val authRepository: AuthRepository,
    private val plantsRepository: PlantsRepository,
    private val marketRepository: MarketRepository,
    private val automationsRepository: AutomationsRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        restoreSession()
    }

    private fun restoreSession() {
        if (!authRepository.hasStoredToken()) {
            _state.update { it.copy(screen = AppScreen.LOGIN) }
            return
        }

        viewModelScope.launch {
            when (val result = authRepository.getCurrentUser()) {
                is ApiResult.Success -> {
                    _state.update { it.copy(screen = AppScreen.MAIN, user = result.data) }
                    openPlants()
                }

                is ApiResult.HttpError -> {
                    if (result.statusCode == 401) {
                        // Token invalid/revoked: clear it and return to Login. A 403
                        // here means valid credentials but not yet onboarded - keep
                        // the token, still go to Login with an explanatory message.
                        authRepository.signOut()
                    }
                    _state.update {
                        it.copy(
                            screen = AppScreen.LOGIN,
                            loginError = if (result.statusCode == 403) {
                                "Your account isn't fully set up yet. Please finish onboarding on the web app."
                            } else {
                                null
                            },
                        )
                    }
                }

                is ApiResult.NetworkError -> _state.update {
                    it.copy(
                        screen = AppScreen.LOGIN,
                        loginError = "Could not reach Voltessa. Check your connection and try again.",
                    )
                }
            }
        }
    }

    fun login(email: String, password: String) {
        if (email.isBlank() || password.isBlank()) {
            _state.update { it.copy(loginError = "Enter your email and password.") }
            return
        }

        _state.update { it.copy(isBusy = true, loginError = null) }

        viewModelScope.launch {
            when (val result = authRepository.signIn(email, password)) {
                is ApiResult.Success -> {
                    _state.update {
                        it.copy(screen = AppScreen.MAIN, user = result.data.user, isBusy = false, loginError = null)
                    }
                    openPlants()
                }

                is ApiResult.HttpError -> _state.update {
                    it.copy(isBusy = false, loginError = loginErrorMessage(result.statusCode, result.errorCode))
                }

                is ApiResult.NetworkError -> _state.update {
                    it.copy(isBusy = false, loginError = "Could not reach Voltessa. Check your connection and try again.")
                }
            }
        }
    }

    /**
     * M5 - called after Android's Credential Manager already obtained and
     * locally validated a Google ID token (see `ui/GoogleSignIn.kt`); this
     * function only exchanges it with the backend, mirroring `login`'s own
     * state handling exactly so both credential paths feel identical to
     * the rest of the app.
     */
    fun loginWithGoogle(idToken: String) {
        _state.update { it.copy(isBusy = true, loginError = null) }

        viewModelScope.launch {
            when (val result = authRepository.signInWithGoogle(idToken)) {
                is ApiResult.Success -> {
                    _state.update {
                        it.copy(screen = AppScreen.MAIN, user = result.data.user, isBusy = false, loginError = null)
                    }
                    openPlants()
                }

                is ApiResult.HttpError -> _state.update {
                    it.copy(isBusy = false, loginError = googleLoginErrorMessage(result.errorCode))
                }

                is ApiResult.NetworkError -> _state.update {
                    it.copy(isBusy = false, loginError = "Could not reach Voltessa. Check your connection and try again.")
                }
            }
        }
    }

    /** Called when the Credential Manager flow itself fails/is cancelled before ever reaching the backend (see `ui/GoogleSignIn.kt`) - never treated as a hard error, since cancelling the account picker is a completely normal thing to do. */
    fun onGoogleSignInCancelledOrFailed(message: String?) {
        _state.update { it.copy(isBusy = false, loginError = message) }
    }

    fun logout() {
        _state.update { it.copy(isBusy = true) }
        viewModelScope.launch {
            authRepository.signOut()
            _state.value = UiState(screen = AppScreen.LOGIN)
        }
    }

    /** Switches the visible section - lazily loads Market/Automations the first time each is opened, not on every switch, so re-entering a tab doesn't re-fetch already-loaded data (the user can still pull the section's own Refresh action). */
    fun selectSection(section: MainSection) {
        _state.update { it.copy(mainSection = section) }

        when (section) {
            MainSection.MARKET -> if (_state.value.market == null && !_state.value.marketBusy) loadMarket()
            MainSection.AUTOMATIONS -> if (_state.value.automationSettings == null && !_state.value.automationsBusy) loadAutomationSettings()
            else -> Unit
        }
    }

    /**
     * M4.1 - fetches the plant list, then immediately loads the dashboard
     * for the default plant (the previously-selected one if it's still in
     * the list, otherwise the first plant) - reusing `selectPlant`'s own
     * fetch logic rather than duplicating it. This is what makes Dashboard
     * show real data immediately after login, with no separate "select a
     * plant" screen in between, matching Web's own single-plant-first
     * behavior (`resolvePlantContext`'s `findFirst`) while still allowing a
     * compact switcher when an organization genuinely has more than one
     * plant.
     */
    fun openPlants() {
        _state.update { it.copy(isBusy = true, plantsError = null) }
        viewModelScope.launch {
            when (val result = plantsRepository.listPlants()) {
                is ApiResult.Success -> {
                    val plants = result.data.plants
                    _state.update { it.copy(plants = plants) }

                    val currentlySelected = _state.value.selectedPlant
                    val defaultPlant = plants.find { it.id == currentlySelected?.id } ?: plants.firstOrNull()

                    if (defaultPlant == null) {
                        _state.update { it.copy(isBusy = false) }
                    } else {
                        selectPlant(defaultPlant)
                    }
                }

                is ApiResult.HttpError -> handleSessionOrError(result.statusCode) { message ->
                    _state.update { it.copy(isBusy = false, plantsError = message) }
                }

                is ApiResult.NetworkError -> _state.update {
                    it.copy(isBusy = false, plantsError = "Could not reach Voltessa. Check your connection.")
                }
            }
        }
    }

    /** Loads connection+dashboard data for `plant` and makes it the current selection - called both by `openPlants`'s auto-selection and by the compact plant switcher when the user has more than one plant. */
    fun selectPlant(plant: PlantDto) {
        _state.update {
            it.copy(
                selectedPlant = plant,
                connection = null,
                dashboard = null,
                detailError = null,
                isBusy = true,
            )
        }

        viewModelScope.launch {
            val connectionResult = plantsRepository.getConnection(plant.id)
            val dashboardResult = plantsRepository.getDashboard(plant.id)

            val connection = (connectionResult as? ApiResult.Success)?.data
            val dashboard = (dashboardResult as? ApiResult.Success)?.data

            val firstError = (connectionResult as? ApiResult.HttpError) ?: (dashboardResult as? ApiResult.HttpError)
            val firstNetworkError = (connectionResult as? ApiResult.NetworkError) ?: (dashboardResult as? ApiResult.NetworkError)

            when {
                connection != null || dashboard != null -> _state.update {
                    it.copy(isBusy = false, connection = connection, dashboard = dashboard)
                }

                firstError != null -> handleSessionOrError(firstError.statusCode) { message ->
                    _state.update { it.copy(isBusy = false, detailError = message) }
                }

                firstNetworkError != null -> _state.update {
                    it.copy(isBusy = false, detailError = "Could not reach Voltessa. Check your connection.")
                }
            }
        }
    }

    /**
     * M4 - Market (organization-scoped, but the endpoint is reached via
     * /api/plants/:plantId/market for URL symmetry with the other
     * plant-scoped mobile endpoints - see that route's own doc comment).
     * Ensures the plant list is loaded first so there's a plant id to call
     * with, exactly mirroring how Web's own Market page is gated behind
     * having a connected plant.
     */
    fun loadMarket() {
        _state.update { it.copy(marketBusy = true, marketError = null) }

        viewModelScope.launch {
            val plants = _state.value.plants.ifEmpty {
                when (val result = plantsRepository.listPlants()) {
                    is ApiResult.Success -> result.data.plants
                    else -> emptyList()
                }
            }

            val plantId = plants.firstOrNull()?.id
            if (plantId == null) {
                _state.update {
                    it.copy(marketBusy = false, marketError = "Connect a plant on the Voltessa web app to see market prices.")
                }
                return@launch
            }

            when (val result = marketRepository.getMarket(plantId)) {
                is ApiResult.Success -> _state.update {
                    it.copy(marketBusy = false, market = result.data)
                }

                is ApiResult.HttpError -> handleSessionOrError(result.statusCode) { message ->
                    _state.update { it.copy(marketBusy = false, marketError = message) }
                }

                is ApiResult.NetworkError -> _state.update {
                    it.copy(marketBusy = false, marketError = "Could not reach Voltessa. Check your connection.")
                }
            }
        }
    }

    fun loadAutomationSettings() {
        _state.update { it.copy(automationsBusy = true, automationsError = null, automationsSaveMessage = null) }

        viewModelScope.launch {
            when (val result = automationsRepository.getSettings()) {
                is ApiResult.Success -> _state.update {
                    it.copy(automationsBusy = false, automationSettings = result.data)
                }

                is ApiResult.HttpError -> handleSessionOrError(result.statusCode) { message ->
                    _state.update { it.copy(automationsBusy = false, automationsError = message) }
                }

                is ApiResult.NetworkError -> _state.update {
                    it.copy(automationsBusy = false, automationsError = "Could not reach Voltessa. Check your connection.")
                }
            }
        }
    }

    fun saveAutomationSettings(enabled: Boolean, minimumExportPrice: String, enabledDays: List<String>) {
        _state.update { it.copy(automationsBusy = true, automationsError = null, automationsSaveMessage = null) }

        viewModelScope.launch {
            when (val result = automationsRepository.updateSettings(enabled, minimumExportPrice, enabledDays)) {
                is ApiResult.Success -> {
                    _state.update { it.copy(automationsBusy = false, automationsSaveMessage = "Saved.") }
                    loadAutomationSettings()
                }

                is ApiResult.HttpError -> handleSessionOrError(result.statusCode) { message ->
                    val displayMessage = if (result.errorCode == "enabledDaysRequired") {
                        "Select at least one day, or turn automation off."
                    } else {
                        message
                    }
                    _state.update { it.copy(automationsBusy = false, automationsError = displayMessage) }
                }

                is ApiResult.NetworkError -> _state.update {
                    it.copy(automationsBusy = false, automationsError = "Could not reach Voltessa. Check your connection.")
                }
            }
        }
    }

    /** 401 anywhere means the session was revoked/expired server-side - sign out locally and return to Login. Anything else becomes a user-friendly message via `onOtherError`. */
    private suspend fun handleSessionOrError(statusCode: Int, onOtherError: (String) -> Unit) {
        if (statusCode == 401) {
            authRepository.signOut()
            _state.value = UiState(screen = AppScreen.LOGIN, loginError = "Your session ended. Please sign in again.")
            return
        }

        onOtherError(
            when (statusCode) {
                403 -> "You don't have access to this."
                404 -> "This isn't available right now. Please try again shortly."
                in 500..599 -> "Voltessa is having a problem right now. Please try again later."
                else -> "Something went wrong."
            },
        )
    }

    private fun loginErrorMessage(statusCode: Int, errorCode: String?): String = when {
        statusCode == 400 -> "Enter your email and password."
        statusCode == 401 -> "Incorrect email or password."
        errorCode == "email_not_verified" -> "Please verify your email before signing in."
        errorCode == "account_inactive" -> "This account is inactive."
        statusCode == 403 -> "Your account isn't fully set up yet. Please finish onboarding on the web app."
        statusCode in 500..599 -> "Voltessa is having a problem right now. Please try again later."
        else -> "Could not sign in. Please try again."
    }

    private fun googleLoginErrorMessage(errorCode: String?): String = when (errorCode) {
        "no_linked_account" -> "No Voltessa account is linked to this Google account. Sign in with your Voltessa password, or use Google on the web app first."
        "account_inactive" -> "This account is inactive."
        "forbidden" -> "Your account isn't fully set up yet. Please finish onboarding on the web app."
        else -> "Could not sign in with Google. Please try again."
    }
}
